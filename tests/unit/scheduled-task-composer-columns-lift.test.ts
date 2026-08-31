import { describe, expect, it } from 'vitest';
import { planComposerColumnsToSegmentsMigration } from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';

describe('planComposerColumnsToSegmentsMigration', () => {
  it('lifts skill_code + workflow_code + recipients into segments and clears columns', () => {
    const plan = planComposerColumnsToSegmentsMigration({
      prompt: '做报告',
      skillCode: 'html',
      workflowCode: 'wf_78f13449',
      dingtalkRecipients: [
        { type: 'user', displayName: '侯正亚', userId: 'u1' },
      ],
      extra: null,
    });

    expect(plan.action).toBe('migrate');
    if (plan.action !== 'migrate') return;
    expect(plan.skillCode).toBeNull();
    expect(plan.workflowCode).toBeNull();
    expect(plan.dingtalkRecipients).toBeNull();
    const segments = plan.extra.composerSegments as Array<{ type: string; slug?: string; id?: string }>;
    expect(segments.map((s) => s.type)).toEqual(
      expect.arrayContaining(['mention', 'skill', 'workflow']),
    );
    expect(segments.some((s) => s.type === 'skill' && s.slug === 'html')).toBe(true);
    expect(segments.some((s) => s.type === 'workflow' && s.id === 'wf_78f13449')).toBe(true);
  });

  it('skips when already clean (null columns + no lift needed)', () => {
    const plan = planComposerColumnsToSegmentsMigration({
      prompt: '做报告',
      skillCode: null,
      workflowCode: null,
      dingtalkRecipients: null,
      extra: {
        composerSegments: [
          { type: 'skill', slug: 'html', title: '姚磊html网页设计' },
          { type: 'workflow', id: 'wf_1', name: 'x', source: 'mine' },
        ],
      },
    });
    expect(plan).toEqual({ action: 'skip', reason: 'already_clean' });
  });

  it('clears columns when segments already have skill/workflow', () => {
    const plan = planComposerColumnsToSegmentsMigration({
      prompt: '做报告',
      skillCode: 'html',
      workflowCode: 'wf_1',
      dingtalkRecipients: null,
      extra: {
        composerSegments: [
          { type: 'skill', slug: 'html', title: '姚磊html网页设计' },
          { type: 'workflow', id: 'wf_1', name: 'x', source: 'mine' },
        ],
      },
    });
    expect(plan.action).toBe('migrate');
    if (plan.action !== 'migrate') return;
    expect(plan.skillCode).toBeNull();
    expect(plan.workflowCode).toBeNull();
    const segments = plan.extra.composerSegments as Array<{ type: string }>;
    expect(segments.filter((s) => s.type === 'skill')).toHaveLength(1);
    expect(segments.filter((s) => s.type === 'workflow')).toHaveLength(1);
  });
});
