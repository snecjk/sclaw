import { describe, expect, it } from 'vitest';
import { getWorkflowDurationMs } from '@/lib/format-workflow-duration';
import { mergeWorkflowCardState } from '@/lib/workflow-card-state-merge';
import {
  bufferWorkflowStatusUpdate,
  consumeBufferedWorkflowStatusUpdate,
} from '@/lib/workflow-status-buffer';

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

  it('does not regress a terminal card when a delayed running event arrives', () => {
    const completed = mergeWorkflowCardState(runningState, {
      runId: 'run_1', workflowId: 'wf_1', status: 'completed', progress: 100,
      steps: [], completedAt: '2026-06-24T10:35:00.000Z', result: { summary: 'done' },
    });
    const delayedRunning = mergeWorkflowCardState(completed, {
      runId: 'run_1', workflowId: 'wf_1', status: 'running', progress: 50, steps: [],
    });

    expect(delayedRunning.status).toBe('completed');
    expect(delayedRunning.progress).toBe(100);
    expect(delayedRunning.result?.summary).toBe('done');
  });

  it('does not move active progress backwards when history is stale', () => {
    const staleHistory = mergeWorkflowCardState(runningState, {
      runId: 'run_1', workflowId: 'wf_1', status: 'running', progress: 0, steps: [],
    });

    expect(staleHistory.progress).toBe(50);
  });

  it('keeps a session-less terminal event until tool-result registration consumes it', () => {
    bufferWorkflowStatusUpdate({
      runId: 'run_legacy_fast', workflowId: 'wf_legacy', status: 'completed', progress: 100,
      steps: [], result: { summary: 'finished before tool response' },
    });

    expect(consumeBufferedWorkflowStatusUpdate('run_legacy_fast')).toMatchObject({
      status: 'completed', progress: 100,
    });
    expect(consumeBufferedWorkflowStatusUpdate('run_legacy_fast')).toBeUndefined();
  });
});
