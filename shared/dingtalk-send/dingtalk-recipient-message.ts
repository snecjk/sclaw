import {
  appendDingTalkMentionContext,
  messageHasDingTalkRecipientContext,
  type DingTalkMentionContextOptions,
} from '../dingtalk-prompts/dingtalk-mention-context';
import {
  hasResolvedDingTalkMentions,
  type DingTalkMention,
} from './dingtalk-mention';

/**
 * 对话 @、定时任务、本地 Cron 统一入口：
 * 在指令正文前注入钉钉收件人 JSON + 发送规范（Agent 随后走 dws chat message send）。
 */
export function buildMessageWithDingTalkRecipients(
  instruction: string,
  mentions?: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  const trimmed = instruction.trim();
  if (!hasResolvedDingTalkMentions(mentions)) return trimmed;
  return appendDingTalkMentionContext(trimmed, mentions, options);
}

/**
 * 对话 chat.send 与任务 Agent Turn 共用：若正文尚未含收件人块则注入，避免重复。
 */
export function prepareDingTalkAgentTurnMessage(
  instruction: string,
  mentions?: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  const trimmed = instruction.trim();
  if (!hasResolvedDingTalkMentions(mentions)) return trimmed;
  if (messageHasDingTalkRecipientContext(trimmed)) return trimmed;
  return buildMessageWithDingTalkRecipients(trimmed, mentions, options);
}
