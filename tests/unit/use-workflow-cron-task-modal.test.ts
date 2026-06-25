import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkflowCronTaskModal } from '@/hooks/use-workflow-cron-task-modal';

const { createJobMock, fetchWorkflowsMock } = vi.hoisted(() => ({
  createJobMock: vi.fn(async () => ({})),
  fetchWorkflowsMock: vi.fn(async () => {}),
}));

vi.mock('@/stores/cron', () => ({
  useCronStore: (selector: (state: { createJob: typeof createJobMock }) => unknown) =>
    selector({ createJob: createJobMock }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: { agents: []; defaultAgentId: string }) => unknown) =>
    selector({ agents: [], defaultAgentId: 'main' }),
}));

vi.mock('@/pages/MyTask/store', () => ({
  useMyTaskStore: {
    getState: () => ({
      workflowOptions: [],
      fetchWorkflows: fetchWorkflowsMock,
    }),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useWorkflowCronTaskModal', () => {
  beforeEach(() => {
    createJobMock.mockClear();
    fetchWorkflowsMock.mockClear();
  });

  it('prefills cron modal with workflowCode from workflow id', async () => {
    const { result } = renderHook(() => useWorkflowCronTaskModal());

    await act(async () => {
      await result.current.openForWorkflow('wf_2c200d96');
    });

    expect(fetchWorkflowsMock).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(true);
    expect(result.current.initialValues).toEqual({ workflowCode: 'wf_2c200d96' });
  });
});
