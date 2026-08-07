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
  useAgentsStore: (
    selector: (state: {
      agents: Array<{ id: string; workspace: string }>;
      defaultAgentId: string;
    }) => unknown,
  ) =>
    selector({
      agents: [{ id: 'main', workspace: '/tmp/ws' }],
      defaultAgentId: 'main',
    }),
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

  it('creates claude task with clean prompt and dingtalkRecipients column', async () => {
    const { result } = renderHook(() => useWorkflowCronTaskModal());
    const mentions = [{ type: 'user' as const, displayName: 'U1', userId: 'u1' }];

    await act(async () => {
      await result.current.handleSave({
        name: '日报',
        schedule: '0 9 * * *',
        message: '生成日报',
        enabled: true,
        engineType: 'claude',
        dingTalkMentions: mentions,
        workflowCode: 'wf_1',
        claudeWorkspacePath: '/tmp/ws',
        claudePermissionProfile: 'dangerous-bypass',
      } as never);
    });

    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engineType: 'claude',
        prompt: '生成日报',
        dingtalkRecipients: mentions,
        workflowCode: 'wf_1',
      }),
    );
    const arg = createJobMock.mock.calls[0][0] as { prompt: string };
    expect(arg.prompt).not.toContain('STOCLAW:DINGTALK_RECIPIENTS');
  });

  it('creates openclaw task with dingtalkRecipients column', async () => {
    const { result } = renderHook(() => useWorkflowCronTaskModal());
    const mentions = [{ type: 'group' as const, displayName: 'G1', openConversationId: 'cid' }];

    await act(async () => {
      await result.current.handleSave({
        name: '周报',
        schedule: '0 10 * * 1',
        message: '生成周报',
        enabled: true,
        engineType: 'openclaw',
        dingTalkMentions: mentions,
        workflowCode: 'wf_2',
      } as never);
    });

    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engineType: 'openclaw',
        prompt: '生成周报',
        dingtalkRecipients: mentions,
      }),
    );
  });
});
