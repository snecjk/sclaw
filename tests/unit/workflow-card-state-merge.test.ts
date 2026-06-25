import { describe, expect, it } from 'vitest';
import { getWorkflowDurationMs } from '@/lib/format-workflow-duration';
import { mergeWorkflowCardState } from '@/lib/workflow-card-state-merge';

describe('mergeWorkflowCardState', () => {
  const runningStartedAt = '2026-06-24T10:26:00.000Z';
  const runningState = {
    runId: 'run_1',
    workflowId: 'wf_1',
    status: 'running' as const,
    progress: 50,
    steps: [],
    startedAt: runningStartedAt,
  };

  it('keeps running startedAt when terminal update arrives with stale createdAt candidate', () => {
    const staleCreatedAt = '2026-06-24T02:00:00.000Z';
    const completedAt = '2026-06-24T10:35:00.000Z';

    const finished = mergeWorkflowCardState(runningState, {
      runId: 'run_1',
      workflowId: 'wf_1',
      status: 'completed',
      progress: 100,
      steps: [],
      startedAt: staleCreatedAt,
      completedAt,
      result: { summary: 'done' },
    });

    expect(finished.startedAt).toBe(runningStartedAt);
    expect(finished.completedAt).toBe(completedAt);
    expect(getWorkflowDurationMs(finished.startedAt, finished.completedAt)).toBe(9 * 60 * 1000);
  });

  it('drops completedAt while still running', () => {
    const merged = mergeWorkflowCardState(runningState, {
      runId: 'run_1',
      workflowId: 'wf_1',
      status: 'running',
      progress: 60,
      steps: [],
      startedAt: runningStartedAt,
      completedAt: '2026-06-24T10:26:01.000Z',
    });

    expect(merged.completedAt).toBeUndefined();
  });
});
