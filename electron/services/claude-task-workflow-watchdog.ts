/**
 * Claude 定时任务·长工作流超时钉钉兜底通知器。
 *
 * 背景：含工作流的 Claude 定时任务在 `timeoutSec` 到点后被 `query.close()` 硬掐断，
 * agent 往往还卡在工作流轮询循环里、尚未执行 `dws chat message send`，导致收件人
 * 收不到任何结果（"钉钉沉默"）。本模块在 worker 判定 `timed_out` 后以 fire-and-forget
 * 方式接管：直接轮询服务端工作流运行态直到终态（或最长 30 分钟），再把最终结果拼成
 * 钉钉正文发给已配置的收件人。
 *
 * 防重发：仅当 worker 观察到至少一个 workflow runId、且 agent 未曾成功发送过钉钉
 * （`dingtalkAlreadySent=false`）时才介入；普通（非工作流）任务超时不触发本兜底，
 * 行为保持不变。
 */
import { logger } from '../utils/logger';
import { runDws } from '../utils/dws-cli';
import {
  parseDingTalkRecipientsFromText,
  type DingTalkMention,
} from '../../shared/dingtalk-mention-context';
import { appendDingTalkAgentSendDisclaimer } from '../../shared/dingtalk-disclaimer';
import {
  checkDwsSendDedup,
  dwsSendRecipientKey,
  recordDwsSent,
} from '../utils/dws-send-dedup';
import { normalizeArtifactUrl } from '../../shared/dws-send-text';
import {
  pollWorkflowRunUntilTerminal,
  type WorkflowRunStatusResult,
} from './workflow-run-client';

export interface WorkflowFallbackParams {
  taskName: string;
  /** 存储 definition 的 promptTemplate——收件人 JSON 嵌在其中。 */
  promptTemplate: string;
  /** worker 从 SDK 消息流捕获到的 workflow runId 集合。 */
  workflowRunIds: string[];
  /** worker 观察到 agent 已成功执行过 `dws chat message send`。 */
  dingtalkAlreadySent: boolean;
  /**
   * agent 最后一条 assistant 文本（执行结果/回答）。非工作流任务（无 runId）
   * 在 agent 未自行发钉钉时，本兜底把它作为正文补发给收件人——不信任模型
   * 一定会遵守"指定即必发"（qwen 等模型偶发回答后反问而不发）。
   */
  lastAssistantText?: string;
}

/** 兜底最长等待时长：覆盖真实长工作流（默认 30 分钟）。 */
const FALLBACK_MAX_WAIT_MS = 30 * 60 * 1000;
const FALLBACK_POLL_INTERVAL_MS = 5_000;

/**
 * 进程内「同一工作流 runId 集合只补发一次」去重锁。
 *
 * 背景：兜底是 fire-and-forget，轮询窗口最长 30 分钟，远超 worker 的 lease
 * （= timeoutSec，分钟级）。worker 在 agent turn 一结束就在 finally 里释放 lease，
 * 而此时兜底仍在轮询工作流到终态。若 cron 间隔短于兜底窗口，调度 tick 会再次
 * due 同一任务并起第二次 agent run——它再次捕获同一 runId 并再 fire 一次兜底，
 * 两个兜底轮询到同一终态后各发一轮，导致每个收件人收到两条一模一样的钉钉。
 *
 * 本锁按 runId 集合指纹去重：指纹相同且「已在轮询中」或「已发送过」且未过时，
 * 直接跳过。check+claim 在首个 await 之前同步完成，单线程下无竞态。
 */
interface FallbackLock {
  running: boolean;
  sent: boolean;
  startedAt: number;
}
const activeFallbacks = new Map<string, FallbackLock>();
const FALLBACK_LOCK_STALE_MS = FALLBACK_MAX_WAIT_MS + 60_000;

/** 按 userId / openConversationId 给收件人去重，防止同一对象被发两次。 */
function dedupRecipients(recipients: DingTalkMention[]): DingTalkMention[] {
  const seen = new Set<string>();
  const out: DingTalkMention[] = [];
  for (const r of recipients) {
    const key =
      r.type === 'group'
        ? `group:${r.openConversationId ?? r.displayName ?? ''}`
        : `user:${r.userId ?? r.displayName ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * 选择适合钉钉正文里点击的产物 URL。
 *
 * - HTML 报告：优先 `previewUrl`（在线预览链，浏览器/钉钉可直接渲染）；
 *   `tempUrl` 是 OSS 签名下载链（attachment），点击会下载 .html 而非预览。
 * - 其他产物：优先 `tempUrl`（`previewUrl` 部分场景是 StoClaw 内部深链/localhost，
 *   钉钉打不开——表现为「蓝色文字却点不动」）。
 *
 * HTML 判定扫描 `name` 及所有 URL 字段是否含 `.html`/`.htm`：`name` 可能不带
 * 扩展名，但 `previewUrl` 的 filePath 参数里通常带 `.html`（`...xxx.html&...`）。
 * 都不是 http(s) 则返回 null（按纯文本展示，避免坏链）。
 */
function isHtmlArtifact(art: {
  name?: string;
  url?: string;
  previewUrl?: string;
  tempUrl?: string;
}): boolean {
  return [art.name, art.url, art.previewUrl, art.tempUrl].some(
    (f) => typeof f === 'string' && /\.html?/i.test(f),
  );
}

function pickDingTalkArtifactUrl(art: {
  name?: string;
  url?: string;
  previewUrl?: string;
  tempUrl?: string;
}): string | null {
  const candidates = isHtmlArtifact(art)
    ? [art.previewUrl, art.url, art.tempUrl]
    : [art.tempUrl, art.url, art.previewUrl];
  for (const c of candidates) {
    const v = c?.trim();
    if (v && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

/**
 * 把产物 URL 规范化成纯 ASCII 且「恰好一次 percent-encoding」，确保钉钉能稳定识别并自动链接化。
 *
 * 工作流产物 URL 的 filePath 常带**原始中文字符**（如
 * `.../总部结算对账分析_日_20260708_1726.html`）。塞进消息后钉钉对非 ASCII
 * 的处理不稳定：偶发整条链接被吞（只剩空 bullet）或丢链只留 label 文本。
 *
 * 同时要防「双重编码」：OSS 后端返回的 `previewUrl`/`tempUrl` 到本处时通常已是
 * percent-encoded（`%E4%B8%AD`）。**`encodeURI` 对已编码串并非幂等**——它会把已存在
 * 的 `%` 再编成 `%25`（`%E4` → `%25E4`），即双重编码、链接失效；若上游某层已错误地
 * `encodeURIComponent` 过一次后果相同。故改用 `normalizeArtifactUrl`（反复 `decodeURI`
 * 剥尽冗余编码层、再 `encodeURI` 一次），无论输入是「原始中文 / 已编码 / 双重（多重）
 * 编码」都收敛到单次编码稳定态，且对任意合法输入幂等、重复调用也安全。
 */
function encodeArtifactUrl(url: string): string {
  return normalizeArtifactUrl(url);
}

/** 产物展示名：去掉换行/制表符，trim 后为空则回退到「(未命名产物)」。 */
function sanitizeArtifactLabel(label: string): string {
  const cleaned = label.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || '(未命名产物)';
}

/**
 * 把单个工作流运行结果拼成一段钉钉正文。
 *
 * 按用户要求：**不输出工作流 id / runId**，只发最终产物（+ 摘要/失败原因）。
 * 非终态无最终产物——发一句不含 id 的提示「任务仍在执行中，请关注 StoClaw。」
 * （任务标题由 `buildFallbackBody` 的 intro 提供）。
 */
function formatRunSection(result: WorkflowRunStatusResult): string {
  if (!result.terminal) {
    return '任务仍在执行中，请关注 StoClaw。';
  }

  if (result.status === 'completed') {
    const lines: string[] = [];
    const summary = result.summary?.trim();
    if (summary) lines.push(summary);

    const arts = result.artifacts;
    if (arts.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('**产物：**');
      for (const a of arts) {
        const url = pickDingTalkArtifactUrl(a);
        const label = sanitizeArtifactLabel(a.name || a.url || '(未命名产物)');
        if (url) {
          // 裸 URL 格式（与发给模型的 P0 指令一致）：钉钉对含中文 URL 的 markdown
          // 链接偶发吞链只剩 label，裸 URL 把链接字面留在正文更稳；且 encodeArtifactUrl
          // 会把后端可能返回的「双重编码」塌缩回单次编码（`%25E5` → `%E5`），把
          // 原始中文统一编码一次，保证整条链接是纯 ASCII。
          lines.push(`- ${label}：${encodeArtifactUrl(url)}`);
        } else {
          lines.push(`- ${label}`);
        }
      }
    }

    if (lines.length === 0) return '';
    return lines.join('\n');
  }

  // failed / timeout / unknown(terminal)
  const reason = result.error?.trim() || result.status || '未成功完成';
  return `未成功完成：${reason}`;
}

function buildFallbackBody(
  taskName: string,
  runs: Array<{ runId: string; result: WorkflowRunStatusResult }>,
): string {
  const intro = `【定时任务·工作流结果】${taskName}`;
  const sections = runs
    .map((r) => formatRunSection(r.result))
    .filter((s) => s.length > 0);
  if (sections.length === 0) return '';
  return [intro, '', ...sections].join('\n');
}

function buildDwsArgsForRecipient(recipient: DingTalkMention, title: string, body: string): string[] | null {
  const text = appendDingTalkAgentSendDisclaimer(body);
  if (recipient.type === 'user' && recipient.userId) {
    return ['chat', 'message', 'send', '--user', recipient.userId, '--title', title, '--text', text, '--format', 'json'];
  }
  if (recipient.type === 'group' && recipient.openConversationId) {
    return ['chat', 'message', 'send', '--group', recipient.openConversationId, '--title', title, '--text', text, '--format', 'json'];
  }
  return null;
}

async function sendToRecipient(recipient: DingTalkMention, title: string, body: string): Promise<boolean> {
  const args = buildDwsArgsForRecipient(recipient, title, body);
  if (!args) {
    logger.warn(
      `[WorkflowWatchdog] skip recipient: missing id (type=${recipient.type}, name=${recipient.displayName})`,
    );
    return false;
  }

  const recipientId = recipient.type === 'user' ? recipient.userId : recipient.openConversationId;
  const recipientKey = dwsSendRecipientKey(recipient.type, recipientId);
  const text = appendDingTalkAgentSendDisclaimer(body);

  // 漏判兜底：正常情况下 agent 发过钉钉后 worker 的 dingtalkAlreadySent 即为 true，
  // 本函数会在入口早退，根本走不到这里。此检查仅针对 worker 检测漏判的边角情形
  // （如 agent 用 worker 正则未覆盖的调用形式发 dws，但 send-guard 的 PostToolUse
  // hook 仍记录进了去重表）——此时用进程内去重表挡住相同正文重发。
  const dedup = checkDwsSendDedup(recipientKey, text);
  if (dedup.recent) {
    logger.info(
      `[WorkflowWatchdog] skip recipient=${recipient.displayName}: ${dedup.reason ?? 'duplicate within TTL'}`,
    );
    return true; // 视为已送达：窗口内 agent 已发过相同正文，无需再补发。
  }

  try {
    const result = await runDws(args, 60_000);
    if (!result.ok) {
      logger.warn(
        `[WorkflowWatchdog] dws send failed (exitCode=${result.exitCode}): ${result.error ?? '(no error)'} recipient=${recipient.displayName}`,
      );
      return false;
    }
    recordDwsSent(recipientKey, text);
    logger.info(`[WorkflowWatchdog] dws send ok -> ${recipient.displayName}`);
    return true;
  } catch (err) {
    logger.warn(
      `[WorkflowWatchdog] dws send threw: ${err instanceof Error ? err.message : String(err)} recipient=${recipient.displayName}`,
    );
    return false;
  }
}

/**
 * 去掉 agent 末尾"是否需要我发送 / 请告诉我发送内容"等违反 rule5 的反问句。
 *
 * 非工作流兜底把 agent 的 lastAssistantText 当正文发给收件人；但模型（尤其
 * qwen）偶发不遵从"指定即必发"，回答后追加"请问您是否需要发送？"请示句。
 * 原样发出去会让收件人收到一句莫名其妙的问话。真实业务结果不会以这类反问
 * 收尾，故只剥尾、不影响正文。
 */
function stripSendConfirmationQuestion(text: string): string {
  const parts = text.split(/(?<=[。？!?！\n])/);
  while (parts.length > 0) {
    const last = parts[parts.length - 1].trim();
    if (!last) { parts.pop(); continue; }
    const isAskBack =
      /(?:是否|是不是|要不要|需不需要|需要我|请告诉|请确认).{0,20}(?:发送|发给|推送给|推送|发出去|内容)/.test(last)
      || /(?:发送|发给|推送给|发出去).{0,12}(?:是否|要不要|需不需要)/.test(last);
    if (isAskBack) parts.pop(); else break;
  }
  return parts.join('').trim();
}

function buildNonWorkflowFallbackBody(taskName: string, lastAssistantText: string): string {
  const intro = `【定时任务】${taskName}`;
  const cleaned = stripSendConfirmationQuestion(lastAssistantText);
  if (!cleaned) return '';
  return [intro, '', cleaned].join('\n');
}

/**
 * 钉钉结果兜底主入口。**永不 reject**（worker 以 fire-and-forget 方式调用）。
 *
 * 触发场景：定时任务结束时含收件人块、但 agent 自身未成功发出钉钉——
 * - 工作流任务：worker 捕获到 runId → 轮询工作流到终态后把结果补发；
 * - 非工作流任务（无 runId）：把 agent 的 lastAssistantText（剥掉末尾反问）
 *   作为正文补发。覆盖模型不遵从"指定即必发"、回答后反问而不发的情形。
 */
export async function sendWorkflowResultFallback(params: WorkflowFallbackParams): Promise<void> {
  const { taskName, promptTemplate, workflowRunIds, dingtalkAlreadySent, lastAssistantText } = params;

  if (dingtalkAlreadySent) {
    logger.info('[WorkflowWatchdog] agent already sent dingtalk; skip fallback.');
    return;
  }

  const parsed = parseDingTalkRecipientsFromText(promptTemplate);
  if (!parsed || parsed.length === 0) {
    logger.info('[WorkflowWatchdog] no dingtalk recipient in promptTemplate; skip fallback.');
    return;
  }
  const recipients = dedupRecipients(parsed);

  const isWorkflow = workflowRunIds.length > 0;
  // 防「同一任务被补发多次」：工作流按 runId 集合指纹，非工作流按任务名+收件人+正文指纹。
  const fingerprint = isWorkflow
    ? `wf:${[...workflowRunIds].sort().join('|')}`
    : `nwf:${taskName}:${recipients
        .map((r) => r.userId ?? r.openConversationId ?? r.displayName ?? '')
        .join(',')}:${(lastAssistantText ?? '').length}:${(lastAssistantText ?? '').slice(0, 80)}`;

  const now = Date.now();
  const existing = activeFallbacks.get(fingerprint);
  if (existing && now - existing.startedAt < FALLBACK_LOCK_STALE_MS) {
    if (existing.sent) {
      logger.info(
        `[WorkflowWatchdog] already sent for ${isWorkflow ? `runs=${workflowRunIds.length}` : 'non-workflow'}; skip duplicate.`,
      );
      return;
    }
    if (existing.running) {
      logger.info(
        `[WorkflowWatchdog] fallback in-flight for ${isWorkflow ? `runs=${workflowRunIds.length}` : 'non-workflow'}; skip duplicate.`,
      );
      return;
    }
  }
  activeFallbacks.set(fingerprint, { running: true, sent: false, startedAt: now });

  logger.info(
    `[WorkflowWatchdog] start fallback task=${taskName} ${isWorkflow ? `runs=${workflowRunIds.length}` : 'mode=non-workflow'} recipients=${recipients.length}`,
  );

  try {
    let body: string;
    if (isWorkflow) {
      // 并发轮询所有 runId 到终态（或整体 30 分钟到点）。runId 之间相互独立。
      const results = await Promise.all(
        workflowRunIds.map((runId) =>
          pollWorkflowRunUntilTerminal(runId, {
            intervalMs: FALLBACK_POLL_INTERVAL_MS,
            maxWaitMs: FALLBACK_MAX_WAIT_MS,
          }).then((result) => ({ runId, result })),
        ),
      );
      body = buildFallbackBody(taskName, results);
    } else {
      body = buildNonWorkflowFallbackBody(taskName, lastAssistantText ?? '');
    }

    // 无可投递内容（工作流全空 / 非工作流 lastAssistantText 为空或只剩反问）就不发，避免空消息。
    if (!body) {
      logger.info(
        `[WorkflowWatchdog] no deliverable result; skip fallback task=${taskName}`,
      );
      activeFallbacks.set(fingerprint, { running: false, sent: true, startedAt: Date.now() });
      return;
    }

    const title = `【定时任务】${taskName}`;
    let okCount = 0;
    for (const recipient of recipients) {
      if (await sendToRecipient(recipient, title, body)) okCount += 1;
    }

    activeFallbacks.set(fingerprint, { running: false, sent: true, startedAt: Date.now() });
    logger.info(
      `[WorkflowWatchdog] fallback done task=${taskName} sent=${okCount}/${recipients.length}`,
    );
  } catch (err) {
    // 兜底绝不向外抛错——worker 未 await 本函数，reject 也无人接住。
    activeFallbacks.set(fingerprint, { running: false, sent: false, startedAt: Date.now() });
    logger.warn(
      `[WorkflowWatchdog] fallback failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
