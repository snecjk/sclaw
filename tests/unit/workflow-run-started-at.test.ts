import { describe, expect, it } from 'vitest';
import { resolveWorkflowRunStartedAt } from '@/lib/workflow-run-status';

describe('resolveWorkflowRunStartedAt', () => {
  it('uses earliest node startedAt when run.startedAt is near completedAt', () => {
    const startedAt = resolveWorkflowRunStartedAt({
      id: 'run-1',
      workflowId: 'wf-1',
      startedAt: '2026-06-15T10:09:59.000Z',
      completedAt: '2026-06-15T10:10:00.000Z',
      nodeRuns: [
        {
          id: 'n1',
          nodeId: 'step-a',
          status: 'completed',
          startedAt: '2026-06-15T10:00:00.000Z',
          completedAt: '2026-06-15T10:05:00.000Z',
        },
        {
          id: 'n2',
          nodeId: 'step-b',
          status: 'completed',
          startedAt: '2026-06-15T10:05:00.000Z',
          completedAt: '2026-06-15T10:10:00.000Z',
        },
      ],
    });

    expect(startedAt).toBe('2026-06-15T10:00:00.000Z');
  });
});
