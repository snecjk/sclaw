import { describe, expect, it } from 'vitest';
import { appendDingTalkMentionContext } from '../../shared/dingtalk-prompts/dingtalk-mention-context';
import {
  planDingTalkRecipientsLift,
  resolveScheduledTaskDingTalkRecipients,
} from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';

const mentions = [
  { type: 'user' as const, displayName: '李峥', userId: 'uid-2' },
];

describe('resolveScheduledTaskDingTalkRecipients', () => {
  it('prefers resolved column over prompt block', () => {
    const fromCol = [{ type: 'user' as const, displayName: '列', userId: 'col-1' }];
    const prompt = appendDingTalkMentionContext('业务', mentions, { scenario: 'scheduled-task' });
    expect(
      resolveScheduledTaskDingTalkRecipients({
        dingtalkRecipients: fromCol,
        prompt,
      }),
    ).toEqual(fromCol);
  });

  it('falls back to prompt block when column is empty', () => {
    const prompt = appendDingTalkMentionContext('业务指令', mentions, {
      scenario: 'scheduled-task',
    });
    expect(
      resolveScheduledTaskDingTalkRecipients({
        dingtalkRecipients: null,
        prompt,
      }),
    ).toEqual(mentions);
  });

  it('returns null when neither column nor prompt has recipients', () => {
    expect(
      resolveScheduledTaskDingTalkRecipients({
        dingtalkRecipients: [],
        prompt: '只做业务，不发钉钉',
      }),
    ).toBeNull();
  });
});

describe('planDingTalkRecipientsLift', () => {
  it('skips when column already resolved', () => {
    const plan = planDingTalkRecipientsLift({
      dingtalkRecipients: mentions,
      prompt: appendDingTalkMentionContext('x', mentions),
    });
    expect(plan).toEqual({ action: 'skip', reason: 'column_resolved' });
  });

  it('plans lift + optional strip from prompt block', () => {
    const prompt = appendDingTalkMentionContext('生成周报', mentions, {
      scenario: 'scheduled-task',
    });
    const plan = planDingTalkRecipientsLift(
      { dingtalkRecipients: null, prompt },
      { stripPromptBlock: true },
    );
    expect(plan.action).toBe('lift');
    if (plan.action !== 'lift') return;
    expect(plan.dingtalkRecipients).toEqual(mentions);
    expect(plan.stripped).toBe(true);
    expect(plan.prompt).toBe('生成周报');
    expect(plan.prompt).not.toContain('STOCLAW:DINGTALK_RECIPIENTS');
  });

  it('skips when prompt has no block', () => {
    expect(
      planDingTalkRecipientsLift({ dingtalkRecipients: null, prompt: 'plain' }),
    ).toEqual({ action: 'skip', reason: 'no_prompt_block' });
  });
});
