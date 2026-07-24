/**
 * 定时任务终态·钉钉兜底发送（抄删掉的 `claude-task-workflow-watchdog.ts` 的
 * `sendToRecipient` 去重语义，不照搬其 workflow 轮询）。
 *
 * 背景：钉钉"指定即必发"由 `buildDingTalkMentionSystemContextForScheduledTask`
 * 烘进 system prompt。但模型（尤其 qwen）偶发不遵从——回答后反问而不发，
 * 收件人收不到任何结果（"钉钉沉默"）。本兜底在 run 终态（成功路径、非
 * timed_out）时接管：agent 未 self-send 的，把 lastAssistantText 发给配置收件人。
 *
 * 防重发：`checkDwsSendDedup` 按 `recipientKey:contentHash` 挡——同一收件人短窗
 * 内已收相同正文则跳过。send-guard hook 已记录 agent 自身的 dws send（同进程
 * 共享 dedup 单例），故 agent 已发相同正文时本兜底自然命中去重跳过。不同正文
 * 的 agent-vs-兜底重复（send-guard 漏记）不在本模块覆盖范围。
 *
 * 永不 reject（fire-and-forget）。无收件人 / 无正文 → 跳过。
 */
import { logger } from '../utils/logger';
import { runDws } from '../utils/dws-cli';
import { appendDingTalkAgentSendDisclaimer } from '../../shared/dingtalk-disclaimer';
import {
  checkDwsSendDedup,
  dwsSendRecipientKey,
  recordDwsSent,
} from '../utils/dws-send-dedup';
import type { DingTalkMention } from '../../shared/dingtalk-mention';
import type { ScheduleTask } from '../db/models/domain/schedule-task';

/** 按 userId / openConversationId 给收件人去重，防同一对象被发两次。 */
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
 * 剥掉 agent 末尾"是否需要我发送 / 请告诉我发送内容"等违反 rule5 的反问句。
 * 真实业务结果不以这类反问收尾，只剥尾、不影响正文。模型（qwen 等）偶发不遵从
 * "指定即必发"时回答后追加请示句，原样发出会让收件人收到莫名问话。
 */
function stripSendConfirmationQuestion(text: string): string {
  const parts = text.split(/(?<=[。？!?！\n])/);
  while (parts.length > 0) {
    const last = parts[parts.length - 1].trim();
    if (!last) {
      parts.pop();
      continue;
    }
    const isAskBack =
      /(?:是否|是不是|要不要|需不需要|需要我|请告诉|请确认).{0,20}(?:发送|发给|推送给|推送|发出去|内容)/.test(
        last,
      )
      || /(?:发送|发给|推送给|发出去).{0,12}(?:是否|要不要|需不需要)/.test(last);
    if (isAskBack) parts.pop();
    else break;
  }
  return parts.join('').trim();
}

function buildDwsArgsForRecipient(
  recipient: DingTalkMention,
  title: string,
  body: string,
): string[] | null {
  const text = appendDingTalkAgentSendDisclaimer(body);
  if (recipient.type === 'user' && recipient.userId) {
    return [
      'chat',
      'message',
      'send',
      '--user',
      recipient.userId,
      '--title',
      title,
      '--text',
      text,
      '--format',
      'json',
    ];
  }
  if (recipient.type === 'group' && recipient.openConversationId) {
    return [
      'chat',
      'message',
      'send',
      '--group',
      recipient.openConversationId,
      '--title',
      title,
      '--text',
      text,
      '--format',
      'json',
    ];
  }
  return null;
}

async function sendToRecipient(
  recipient: DingTalkMention,
  title: string,
  body: string,
): Promise<boolean> {
  const args = buildDwsArgsForRecipient(recipient, title, body);
  if (!args) {
    logger.warn(
      '[scheduled-task-dingtalk] skip recipient: missing id',
      { type: recipient.type, name: recipient.displayName },
    );
    return false;
  }

  const recipientId = recipient.type === 'user' ? recipient.userId : recipient.openConversationId;
  const recipientKey = dwsSendRecipientKey(recipient.type, recipientId);
  const text = appendDingTalkAgentSendDisclaimer(body);

  // 去重：send-guard hook 已记录 agent 的 dws send（相同正文则命中跳过）。
  const dedup = checkDwsSendDedup(recipientKey, text);
  if (dedup.recent) {
    logger.info(
      '[scheduled-task-dingtalk] skip recipient: duplicate within TTL',
      { recipient: recipient.displayName, reason: dedup.reason ?? 'duplicate' },
    );
    return true; // 视为已送达：窗口内已发过相同正文，无需再补。
  }

  try {
    const result = await runDws(args, 60_000);
    if (!result.ok) {
      logger.warn(
        '[scheduled-task-dingtalk] dws send failed',
        { exitCode: result.exitCode, error: result.error ?? '(no error)', recipient: recipient.displayName },
      );
      return false;
    }
    recordDwsSent(recipientKey, text);
    logger.info('[scheduled-task-dingtalk] dws send ok', { recipient: recipient.displayName });
    return true;
  } catch (err) {
    logger.warn(
      '[scheduled-task-dingtalk] dws send threw',
      { error: err instanceof Error ? err.message : String(err), recipient: recipient.displayName },
    );
    return false;
  }
}

/**
 * 终态兜底主入口。**永不 reject**（fire-and-forget，executor onTerminal 成功路径
 * 末尾 `void` 调用）。无收件人 / 无正文（剥反问后空）→ 跳过，不发空消息。
 */
export async function sendScheduledTaskResultFallback(params: {
  task: ScheduleTask;
  lastAssistantText: string;
}): Promise<void> {
  const { task, lastAssistantText } = params;
  const recipients = dedupRecipients(task.dingtalkRecipients ?? []);
  if (recipients.length === 0 || !lastAssistantText.trim()) {
    logger.info('[scheduled-task-dingtalk] fallback skipped (no recipient or empty text)', {
      taskId: task.id,
    });
    return;
  }

  const cleaned = stripSendConfirmationQuestion(lastAssistantText);
  if (!cleaned) {
    logger.info('[scheduled-task-dingtalk] fallback skipped (only ask-back left)', {
      taskId: task.id,
    });
    return;
  }

  const body = `【定时任务】${task.name}\n\n${cleaned}`;
  const title = `【定时任务】${task.name}`;

  let okCount = 0;
  for (const recipient of recipients) {
    if (await sendToRecipient(recipient, title, body)) okCount += 1;
  }
  logger.info('[scheduled-task-dingtalk] fallback done', {
    taskId: task.id,
    sent: okCount,
    total: recipients.length,
  });
}
