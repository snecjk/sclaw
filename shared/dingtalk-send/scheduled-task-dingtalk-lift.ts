/**
 * 存量定时任务：prompt 内嵌收件人块 / 列存 → extra.composerSegments 迁移与运行时解析。
 * 运行时降级链：extra.composerSegments mention → 列 → prompt 块。
 */
import {
  hasResolvedDingTalkMentions,
  type DingTalkMention,
} from './dingtalk-mention';
import {
  parseDingTalkRecipientsFromText,
  stripDingTalkMentionContextForDisplay,
} from '../dingtalk-prompts/dingtalk-mention-context';

export type ScheduledTaskComposerMentionSegment = {
  type: 'mention';
  mention: DingTalkMention;
};

export type ScheduledTaskDingTalkSource = {
  dingtalkRecipients?: DingTalkMention[] | null;
  prompt?: string | null;
  extra?: Record<string, unknown> | null;
};

/** 从 extra.composerSegments 提取已 resolved 的钉钉 mention。 */
export function extractDingTalkMentionsFromComposerSegments(
  extra?: Record<string, unknown> | null,
): DingTalkMention[] | null {
  const segments = extra?.composerSegments;
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const mentions: DingTalkMention[] = [];
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') continue;
    const record = seg as Record<string, unknown>;
    if (record.type !== 'mention') continue;
    const mention = record.mention;
    if (!mention || typeof mention !== 'object') continue;
    mentions.push(mention as DingTalkMention);
  }
  if (!hasResolvedDingTalkMentions(mentions)) return null;
  return mentions;
}

/**
 * extra.composerSegments mention 优先；其次列；再解析 prompt 内历史 Recipients 块。
 */
export function resolveScheduledTaskDingTalkRecipients(
  task: ScheduledTaskDingTalkSource,
): DingTalkMention[] | null {
  const fromExtra = extractDingTalkMentionsFromComposerSegments(task.extra);
  if (fromExtra) return fromExtra;

  if (hasResolvedDingTalkMentions(task.dingtalkRecipients)) {
    return task.dingtalkRecipients ?? null;
  }
  const fromPrompt = parseDingTalkRecipientsFromText(task.prompt ?? '');
  if (fromPrompt && hasResolvedDingTalkMentions(fromPrompt)) {
    return fromPrompt;
  }
  return null;
}

export type DingTalkRecipientsLiftPlan =
  | { action: 'skip'; reason: 'column_resolved' | 'no_prompt_block' | 'prompt_unresolved' }
  | {
      action: 'lift';
      reason: 'prompt_block';
      dingtalkRecipients: DingTalkMention[];
      /** stripPromptBlock=true 时为剥块后的业务指令；否则与原 prompt 相同 */
      prompt: string;
      stripped: boolean;
    };

/**
 * 规划一次性回填：列已 resolved → 跳过；否则从 prompt 块提取。
 * `stripPromptBlock` 为 true 时尝试剥掉块，仅保留业务指令；剥空则保留原 prompt。
 * @deprecated 被 planComposerSegmentsRecipientsMigration 取代；保留供旧脚本/测试。
 */
export function planDingTalkRecipientsLift(
  task: ScheduledTaskDingTalkSource,
  options?: { stripPromptBlock?: boolean },
): DingTalkRecipientsLiftPlan {
  if (hasResolvedDingTalkMentions(task.dingtalkRecipients)) {
    return { action: 'skip', reason: 'column_resolved' };
  }

  const fromPrompt = parseDingTalkRecipientsFromText(task.prompt ?? '');
  if (!fromPrompt?.length) {
    return { action: 'skip', reason: 'no_prompt_block' };
  }
  if (!hasResolvedDingTalkMentions(fromPrompt)) {
    return { action: 'skip', reason: 'prompt_unresolved' };
  }

  const original = task.prompt ?? '';
  let prompt = original;
  let stripped = false;
  if (options?.stripPromptBlock) {
    const cleaned = stripDingTalkMentionContextForDisplay(original).trim();
    if (cleaned) {
      prompt = cleaned;
      stripped = true;
    }
  }

  return {
    action: 'lift',
    reason: 'prompt_block',
    dingtalkRecipients: fromPrompt,
    prompt,
    stripped,
  };
}

export type ComposerSegmentsRecipientsMigrationPlan =
  | {
      action: 'skip';
      reason: 'already_in_extra' | 'no_recipients';
    }
  | {
      action: 'migrate';
      reason: 'column' | 'prompt_block' | 'column_and_prompt';
      prompt: string;
      stripped: boolean;
      dingtalkRecipients: null;
      extra: Record<string, unknown>;
      mentions: DingTalkMention[];
    };

function mergeMentionSegmentsIntoExtra(
  extra: Record<string, unknown> | null | undefined,
  mentions: DingTalkMention[],
): Record<string, unknown> {
  const base = extra && typeof extra === 'object' ? { ...extra } : {};
  const existing = Array.isArray(base.composerSegments)
    ? [...(base.composerSegments as unknown[])]
    : [];
  const withoutMentions = existing.filter((seg) => {
    if (!seg || typeof seg !== 'object') return true;
    return (seg as { type?: string }).type !== 'mention';
  });
  const mentionSegments: ScheduledTaskComposerMentionSegment[] = mentions.map((mention) => ({
    type: 'mention',
    mention,
  }));
  base.composerSegments = [...mentionSegments, ...withoutMentions];
  return base;
}

/**
 * 规划收件人 → extra.composerSegments 迁移：
 * - 已有 extra mention segments → skip
 * - 从列或 prompt 块取 mentions → 写入 segments、剥 prompt 块、清空列
 */
export function planComposerSegmentsRecipientsMigration(
  task: ScheduledTaskDingTalkSource,
): ComposerSegmentsRecipientsMigrationPlan {
  if (extractDingTalkMentionsFromComposerSegments(task.extra)) {
    return { action: 'skip', reason: 'already_in_extra' };
  }

  const fromColumn = hasResolvedDingTalkMentions(task.dingtalkRecipients)
    ? (task.dingtalkRecipients ?? null)
    : null;
  const fromPrompt = parseDingTalkRecipientsFromText(task.prompt ?? '');
  const promptResolved =
    fromPrompt && hasResolvedDingTalkMentions(fromPrompt) ? fromPrompt : null;

  const mentions = fromColumn ?? promptResolved;
  if (!mentions?.length) {
    return { action: 'skip', reason: 'no_recipients' };
  }

  const original = task.prompt ?? '';
  const cleaned = stripDingTalkMentionContextForDisplay(original).trim();
  const stripped = Boolean(cleaned && cleaned !== original.trim());
  const prompt = cleaned || original;

  let reason: 'column' | 'prompt_block' | 'column_and_prompt' = 'prompt_block';
  if (fromColumn && promptResolved) reason = 'column_and_prompt';
  else if (fromColumn) reason = 'column';

  return {
    action: 'migrate',
    reason,
    prompt,
    stripped,
    dingtalkRecipients: null,
    extra: mergeMentionSegmentsIntoExtra(task.extra, mentions),
    mentions,
  };
}
