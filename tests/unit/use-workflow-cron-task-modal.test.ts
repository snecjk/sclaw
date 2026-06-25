import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkflowCronTaskModal } from '@/hooks/use-workflow-cron-task-modal';

const { createJobMock } = vi.hoisted(() => ({
  createJobMock: vi.fn(async () => ({})),
}));

vi.mock('@/stores/cron', () => ({
  useCronStore: (selector: (state: { createJob: typeof createJobMock }) => unknown) =>
    selector({ createJob: createJobMock }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: { agents: []; defaultAgentId: string }) => unknown) =>
    selector({ agents: [], defaultAgentId: 'main' }),
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
  });

  it('prefills cron modal instructions from workflow id', () => {
    const { result } = renderHook(() => useWorkflowCronTaskModal());

    act(() => {
      result.current.openForWorkflow('wf_2c200d96');
    });

    expect(result.current.open).toBe(true);
    expect(result.current.initialValues).toEqual({ message: '执行 wf_2c200d96 工作流' });
  });
});
