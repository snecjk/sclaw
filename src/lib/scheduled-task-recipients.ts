import { prepareDingTalkAgentTurnMessage } from '../../shared/dingtalk-send/dingtalk-recipient-message';
import { stripSkillTranscriptMarkers } from '../../shared/skill-transcript-marker';
import {
  hasResolvedDingTalkMentions,
  messageHasDingTalkRecipientContext,
  stripDingTalkMentionContextForDisplay,
} from '@/lib/dingtalk-mention-context';
import { stripComposerModelBakeForDisplay } from '@/lib/user-message-display';
import type { DingTalkMention } from '@/types/dingtalk-mention';

/** DingTalk recipient fields shared by local cron/claude task definitions. */
interface ScheduledTaskDingTalkFields {
  dingdingId?: string | null;
  dingdingGroupId?: string | null;
  dingdingGroupName?: string | null;
}

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

export function scheduledTaskToMentions(task: Pick<ScheduledTaskDingTalkFields, 'dingdingId' | 'dingdingGroupId' | 'dingdingGroupName'>): DingTalkMention[] {
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
  task?: Pick<ScheduledTaskDingTalkFields, 'dingdingId' | 'dingdingGroupId' | 'dingdingGroupName'> | null,
): DingTalkMention[] {
  const fromMessage = parseMentionsFromRecipientContext(message);
  if (fromMessage.length > 0) return fromMessage;
  return task ? scheduledTaskToMentions(task) : [];
}

/**
 * 老数据兜底：`stripDingTalkMentionContextForDisplay` 对「只有收件人块、无 `用户消息：`
 * 边界」的老 prompt 返回 `''`。这里 lenient 地剥掉收件人块（marker + ```json``` 围栏 +
 * 定时任务编号规则行 + legacy marker/heading），保留剩余正文，再经
 * `stripComposerModelBakeForDisplay` 剥 `[文件:]`/`[技能:]` 占位符，避免编辑框空白
 * 且不泄漏收件人 header / 占位符。仅当 primary 为空时启用，正常数据不受影响。
 */
function stripRecipientBlockLenient(message: string): string {
  if (!messageHasDingTalkRecipientContext(message)) return message;
  const lines = message.split('\n');
  const kept: string[] = [];
  let skippingJsonFence = false;
  for (const line of lines) {
    if (skippingJsonFence) {
      if (line.trim() === '```') {
        skippingJsonFence = false;
      }
      continue;
    }
    if (line.includes('[STOCLAW:DINGTALK_RECIPIENTS:v1]')) continue;
    if (line.includes('<!-- StoClaw-DingTalk-Recipients: do-not-search -->')) continue;
    if (/^##\s+(?:SClaw|StoClaw) DingTalk Recipients/.test(line)) continue;
    if (/^```json\b/.test(line.trim())) {
      if (line.trim().endsWith('```') && line.trim().length > '```json```'.length) {
        continue;
      }
      skippingJsonFence = true;
      continue;
    }
    // 定时任务收件人块的编号规则行（模块 C 短必发/并集/同正文/禁回执）。
    if (/^\s*[4-6]\.\s/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

export function stripInstructionFromTaskMessage(
  message: string,
  segments?: Array<{ type?: string; text?: string }> | null,
): string {
  // 存量任务 prompt 可能仍含 SClaw-Skill marker（含 userText 字面 \n）；编辑/列表展示一律剥掉。
  const withoutSkillMarker = stripSkillTranscriptMarkers(message);
  const primary = stripDingTalkMentionContextForDisplay(withoutSkillMarker);
  if (primary) return primary;
  // primary 为空：收件人块无 `用户消息：` 边界（老数据）。
  // 若 segments 已含 text，编辑回填走 segments 路径，无需兜底（避免覆盖 segments）。
  const hasSegmentText = segments?.some(
    (seg) => seg?.type === 'text' && typeof seg.text === 'string' && seg.text.trim().length > 0,
  );
  if (hasSegmentText) return '';
  // 老数据兜底：组合清洗（剥收件人块 + 剥占位符），保留剩余正文，避免编辑框空白。
  const fallback = stripComposerModelBakeForDisplay(stripRecipientBlockLenient(withoutSkillMarker)).trim();
  return fallback;
}

/** @deprecated 使用 prepareDingTalkAgentTurnMessage */
export function buildTaskMessageWithRecipients(
  instruction: string,
  mentions?: DingTalkMention[],
): string {
  // 本函数仅用于定时任务 description 烘焙，固定必发语义。
  return prepareDingTalkAgentTurnMessage(instruction, mentions, { scenario: 'scheduled-task' });
}

export { prepareDingTalkAgentTurnMessage } from '../../shared/dingtalk-send/dingtalk-recipient-message';

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
