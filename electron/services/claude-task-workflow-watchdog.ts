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
}

/** 兜底最长等待时长：覆盖真实长工作流（默认 30 分钟）。 */
const FALLBACK_MAX_WAIT_MS = 30 * 60 * 1000;
const FALLBACK_POLL_INTERVAL_MS = 5_000;

const SHORT_RUN_ID_LEN = 8;

function shortRunId(runId: string): string {
  return runId ? runId.slice(0, SHORT_RUN_ID_LEN) : runId;
}

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

/** 把单个工作流运行结果拼成一段钉钉正文。 */
function formatRunSection(runId: string, result: WorkflowRunStatusResult): string {
  const head = `### 工作流 ${shortRunId(runId)}`;

  if (!result.terminal) {
    return `${head}\n\n仍在运行中，请到 StoClaw 查看最新状态。`;
  }

  if (result.status === 'completed') {
    const summary = result.summary?.trim() || '(无摘要)';
    const lines = [head, '', summary];
    const arts = result.artifacts;
    if (arts.length > 0) {
      lines.push('', '**产物：**');
      for (const a of arts) {
        const label = a.name || a.url || '(未命名产物)';
        lines.push(a.url ? `- [${label}](${a.url})` : `- ${label}`);
      }
    }
    return lines.join('\n');
  }

  // failed / timeout / unknown(terminal)
  const reason = result.error?.trim() || result.status || '未成功完成';
  return `${head}\n\n未成功完成：${reason}`;
}

function buildFallbackBody(taskName: string, runs: Array<{ runId: string; result: WorkflowRunStatusResult }>): string {
  const intro = `【定时任务·工作流结果】${taskName}`;
  const sections = runs.map((r) => formatRunSection(r.runId, r.result));
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
 * 工作流结果钉钉兜底主入口。**永不 reject**（worker 以 fire-and-forget 方式调用）。
 *
 * 触发场景：agent 跑了工作流（worker 捕获到 runId）但自身未成功发出钉钉——
 * 包括超时卡死（agent 未及发出）与正常结束却未发（agent 决策遗漏，最常见于
 * prompt 仅要求"执行工作流"而未要求"把结果发钉钉"）。两种情况都由本函数
 * 轮询 runId 到终态后把结果补发给已配置收件人。
 */
export async function sendWorkflowResultFallback(params: WorkflowFallbackParams): Promise<void> {
  const { taskName, promptTemplate, workflowRunIds, dingtalkAlreadySent } = params;

  if (dingtalkAlreadySent) {
    logger.info('[WorkflowWatchdog] agent already sent dingtalk; skip fallback.');
    return;
  }
  if (!workflowRunIds.length) {
    logger.info('[WorkflowWatchdog] no workflow runId captured; skip fallback (non-workflow task).');
    return;
  }

  const parsed = parseDingTalkRecipientsFromText(promptTemplate);
  if (!parsed || parsed.length === 0) {
    logger.info('[WorkflowWatchdog] no dingtalk recipient in promptTemplate; skip fallback.');
    return;
  }
  const recipients = dedupRecipients(parsed);

  // 防「同一 runId 集合被补发多次」：详见 activeFallbacks 注释。
  const fingerprint = [...workflowRunIds].sort().join('|');
  const now = Date.now();
  const existing = activeFallbacks.get(fingerprint);
  if (existing && now - existing.startedAt < FALLBACK_LOCK_STALE_MS) {
    if (existing.sent) {
      logger.info(
        `[WorkflowWatchdog] already sent for runs=${workflowRunIds.length}; skip duplicate.`,
      );
      return;
    }
    if (existing.running) {
      logger.info(
        `[WorkflowWatchdog] fallback in-flight for runs=${workflowRunIds.length}; skip duplicate.`,
      );
      return;
    }
  }
  activeFallbacks.set(fingerprint, { running: true, sent: false, startedAt: now });

  logger.info(
    `[WorkflowWatchdog] start fallback task=${taskName} runs=${workflowRunIds.length} recipients=${recipients.length}`,
  );

  try {
    // 并发轮询所有 runId 到终态（或整体 30 分钟到点）。runId 之间相互独立。
    const results = await Promise.all(
      workflowRunIds.map((runId) =>
        pollWorkflowRunUntilTerminal(runId, {
          intervalMs: FALLBACK_POLL_INTERVAL_MS,
          maxWaitMs: FALLBACK_MAX_WAIT_MS,
        }).then((result) => ({ runId, result })),
      ),
    );

    const title = `【定时任务】${taskName}`;
    const body = buildFallbackBody(taskName, results);

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
