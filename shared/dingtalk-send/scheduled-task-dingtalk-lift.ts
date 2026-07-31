/**
 * 存量定时任务：prompt 内嵌收件人块 → 列存回填规划 / 运行时解析。
 * 列优先；列空或未 resolved 时再解析 prompt。
 */
import {
  hasResolvedDingTalkMentions,
  type DingTalkMention,
} from './dingtalk-mention';
import {
  parseDingTalkRecipientsFromText,
  stripDingTalkMentionContextForDisplay,
} from '../dingtalk-prompts/dingtalk-mention-context';

export type ScheduledTaskDingTalkSource = {
  dingtalkRecipients?: DingTalkMention[] | null;
  prompt?: string | null;
};

/** 列优先；列空则从 prompt 内历史 Recipients 块解析。 */
export function resolveScheduledTaskDingTalkRecipients(
  task: ScheduledTaskDingTalkSource,
): DingTalkMention[] | null {
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
