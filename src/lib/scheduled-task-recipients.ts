import { prepareDingTalkAgentTurnMessage } from '../../shared/dingtalk-recipient-message';
import {
  hasResolvedDingTalkMentions,
  messageHasDingTalkRecipientContext,
  stripDingTalkMentionContextForDisplay,
} from '@/lib/dingtalk-mention-context';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { ScheduledTask } from '@/types/scheduled-task';

export function parseMentionsFromRecipientContext(message: string): DingTalkMention[] {
  if (!messageHasDingTalkRecipientContext(message)) return [];

  const jsonMatch = message.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!jsonMatch?.[1]) return [];

  try {
    const payload = JSON.parse(jsonMatch[1]) as {
      recipients?: Array<{
        type?: string;
        displayName?: string;
        userId?: string;
        openConversationId?: string;
        corpId?: string;
      }>;
    };

    const mentions: DingTalkMention[] = [];
    for (const recipient of payload.recipients ?? []) {
      const displayName = recipient.displayName?.trim();
      if (!displayName) continue;
      if (recipient.type === 'user' && recipient.userId?.trim()) {
        mentions.push({
          type: 'user',
          displayName,
          userId: recipient.userId.trim(),
          corpId: recipient.corpId?.trim() || undefined,
        });
        continue;
      }
      if (recipient.type === 'group' && recipient.openConversationId?.trim()) {
        mentions.push({
          type: 'group',
          displayName,
          openConversationId: recipient.openConversationId.trim(),
          corpId: recipient.corpId?.trim() || undefined,
        });
      }
    }
    return mentions;
  } catch {
    return [];
  }
}

export function scheduledTaskToMentions(task: Pick<ScheduledTask, 'dingdingId' | 'dingdingGroupId' | 'dingdingGroupName'>): DingTalkMention[] {
  const mentions: DingTalkMention[] = [];
  if (task.dingdingId) {
    mentions.push({
      type: 'user',
      displayName: task.dingdingId,
      userId: task.dingdingId,
    });
  }
  if (task.dingdingGroupId) {
    mentions.push({
      type: 'group',
      displayName: task.dingdingGroupName?.trim() || task.dingdingGroupId,
      openConversationId: task.dingdingGroupId,
    });
  }
  return mentions;
}

export function resolveScheduledTaskMentions(
  message: string,
  task?: Pick<ScheduledTask, 'dingdingId' | 'dingdingGroupId' | 'dingdingGroupName'> | null,
): DingTalkMention[] {
  const fromMessage = parseMentionsFromRecipientContext(message);
  if (fromMessage.length > 0) return fromMessage;
  return task ? scheduledTaskToMentions(task) : [];
}

export function stripInstructionFromTaskMessage(message: string): string {
  return stripDingTalkMentionContextForDisplay(message);
}

/** @deprecated 使用 prepareDingTalkAgentTurnMessage */
export function buildTaskMessageWithRecipients(
  instruction: string,
  mentions?: DingTalkMention[],
): string {
  // 本函数仅用于定时任务 description 烘焙，固定必发语义。
  return prepareDingTalkAgentTurnMessage(instruction, mentions, { scenario: 'scheduled-task' });
}

export { prepareDingTalkAgentTurnMessage } from '../../shared/dingtalk-recipient-message';

export function mentionsToScheduledTaskFields(mentions: DingTalkMention[]): {
  notifyMode?: string;
  dingdingId?: string;
  dingdingGroupId?: string;
  dingdingGroupName?: string;
} {
  if (!hasResolvedDingTalkMentions(mentions)) return {};

  const users = mentions!.filter((mention) => mention.type === 'user' && mention.userId);
  const groups = mentions!.filter((mention) => mention.type === 'group' && mention.openConversationId);

  return {
    notifyMode: 'dingtalk',
    ...(users[0]?.userId ? { dingdingId: users[0].userId } : {}),
    ...(groups[0]?.openConversationId
      ? {
          dingdingGroupId: groups[0].openConversationId,
          dingdingGroupName: groups[0].displayName,
        }
      : {}),
  };
}

interface CronDescriptionMeta {
  agentId?: string;
  dingTalkMentions?: DingTalkMention[];
  workflowCode?: string;
}

export function parseCronDescriptionMeta(description?: string | null): CronDescriptionMeta {
  if (!description?.trim()) return {};
  try {
    const meta = JSON.parse(description) as CronDescriptionMeta;
    if (!meta || typeof meta !== 'object') return {};
    return meta;
  } catch {
    return {};
  }
}

export function buildCronDescriptionMeta(
  agentId: string | null | undefined,
  mentions?: DingTalkMention[],
  workflowCode?: string,
): string | undefined {
  const meta: CronDescriptionMeta = {};
  if (agentId?.trim()) meta.agentId = agentId.trim();
  if (hasResolvedDingTalkMentions(mentions)) meta.dingTalkMentions = mentions;
  if (workflowCode?.trim()) meta.workflowCode = workflowCode.trim();
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined;
}
