import { describe, expect, it } from 'vitest';
import { appendDingTalkMentionContext } from '../../shared/dingtalk-prompts/dingtalk-mention-context';
import {
  extractDingTalkMentionsFromComposerSegments,
  planComposerSegmentsRecipientsMigration,
  planDingTalkRecipientsLift,
  resolveScheduledTaskDingTalkRecipients,
} from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';

const mentions = [
  { type: 'user' as const, displayName: '李峥', userId: 'uid-2' },
];

describe('resolveScheduledTaskDingTalkRecipients', () => {
  it('prefers extra.composerSegments over column and prompt', () => {
    const fromExtra = [{ type: 'user' as const, displayName: '段', userId: 'seg-1' }];
    const fromCol = [{ type: 'user' as const, displayName: '列', userId: 'col-1' }];
    const prompt = appendDingTalkMentionContext('业务', mentions, { scenario: 'scheduled-task' });
    expect(
      resolveScheduledTaskDingTalkRecipients({
        extra: {
          composerSegments: fromExtra.map((mention) => ({ type: 'mention', mention })),
        },
        dingtalkRecipients: fromCol,
        prompt,
      }),
    ).toEqual(fromExtra);
  });

  it('prefers resolved column over prompt block when extra empty', () => {
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

describe('extractDingTalkMentionsFromComposerSegments', () => {
  it('returns resolved mentions from segments', () => {
    expect(
      extractDingTalkMentionsFromComposerSegments({
        composerSegments: [
          { type: 'text', text: 'hi' },
          { type: 'mention', mention: mentions[0] },
        ],
      }),
    ).toEqual(mentions);
  });

  it('returns null when mentions unresolved', () => {
    expect(
      extractDingTalkMentionsFromComposerSegments({
        composerSegments: [
          { type: 'mention', mention: { type: 'user', displayName: '无 id' } },
        ],
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

describe('planComposerSegmentsRecipientsMigration', () => {
  it('skips when extra already has mention segments', () => {
    const plan = planComposerSegmentsRecipientsMigration({
      dingtalkRecipients: mentions,
      prompt: '业务',
      extra: {
        composerSegments: [{ type: 'mention', mention: mentions[0] }],
      },
    });
    expect(plan).toEqual({ action: 'skip', reason: 'already_in_extra' });
  });

  it('migrates column recipients into extra and clears column', () => {
    const plan = planComposerSegmentsRecipientsMigration({
      dingtalkRecipients: mentions,
      prompt: '生成周报',
      extra: { foo: 1 },
    });
    expect(plan.action).toBe('migrate');
    if (plan.action !== 'migrate') return;
    expect(plan.reason).toBe('column');
    expect(plan.dingtalkRecipients).toBeNull();
    expect(plan.prompt).toBe('生成周报');
    expect(plan.extra.foo).toBe(1);
    expect(plan.extra.composerSegments).toEqual([
      { type: 'mention', mention: mentions[0] },
    ]);
  });

  it('migrates prompt block: strip + write segments', () => {
    const prompt = appendDingTalkMentionContext('生成周报', mentions, {
      scenario: 'scheduled-task',
    });
    const plan = planComposerSegmentsRecipientsMigration({
      dingtalkRecipients: null,
      prompt,
    });
    expect(plan.action).toBe('migrate');
    if (plan.action !== 'migrate') return;
    expect(plan.reason).toBe('prompt_block');
    expect(plan.stripped).toBe(true);
    expect(plan.prompt).toBe('生成周报');
    expect(plan.prompt).not.toContain('STOCLAW:DINGTALK_RECIPIENTS');
    expect(plan.dingtalkRecipients).toBeNull();
    expect(plan.mentions).toEqual(mentions);
  });

  it('skips when no recipients anywhere', () => {
    expect(
      planComposerSegmentsRecipientsMigration({
        dingtalkRecipients: null,
        prompt: 'plain',
      }),
    ).toEqual({ action: 'skip', reason: 'no_recipients' });
  });
});
