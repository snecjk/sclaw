import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WorkflowCard } from '@/components/workflow/WorkflowCard';

const { chatState, getChatWorkflowCard } = vi.hoisted(() => ({
  chatState: {
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    workflowCardStates: {} as Record<string, {
      runId: string;
      workflowId: string;
      status: string;
      progress: number;
      steps: [];
    }>,
  },
  getChatWorkflowCard: vi.fn(),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/lib/workflow-api', () => ({
  getChatWorkflowCard: (runId: string) => getChatWorkflowCard(runId),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { workflowId?: string }) => {
      if (key === 'workflow.backgroundRunningWithId' && opts?.workflowId) {
        return `工作流后台执行中（工作流 ID: ${opts.workflowId}）`;
      }
      if (key === 'workflow.defaultName') return '工作流';
      if (key === 'workflow.createScheduledTaskAction') return '创建定时任务';
      return key;
    },
  }),
}));

describe('WorkflowCard scheduled task action', () => {
  beforeEach(() => {
    chatState.workflowCardStates = {};
    getChatWorkflowCard.mockImplementation(async (runId: string) => (
      chatState.workflowCardStates[runId] ?? null
    ));
  });

  it('shows create scheduled task action for completed workflow with workflow id', async () => {
    chatState.workflowCardStates.run_123 = {
      runId: 'run_123',
      workflowId: 'wf_abc',
      status: 'completed',
      progress: 100,
      steps: [],
    };

    render(
      <WorkflowCard
        runId="run_123"
        templateName="测试工作流"
        onCreateScheduledTask={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: '创建定时任务' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查看工作流' })).toBeNull();
    expect(screen.getByText('run_123')).toBeTruthy();
    expect(screen.getByText('测试工作流（wf_abc）')).toBeTruthy();
    expect(screen.getByText('workflow.statusCompleted')).toBeTruthy();
  });

  it('shows workflow id title when template name is a template id', async () => {
    chatState.workflowCardStates.run_123 = {
      runId: 'run_123',
      workflowId: 'wf_2496580c',
      status: 'running',
      progress: 0,
      steps: [],
    };

    render(
      <WorkflowCard
        runId="run_123"
        templateName="tpl_3ec98fd9"
      />,
    );

    expect(await screen.findByText('工作流（wf_2496580c）')).toBeTruthy();
  });

  it('hides create scheduled task action while workflow is running', () => {
    chatState.workflowCardStates.run_123 = {
      runId: 'run_123',
      workflowId: 'wf_abc',
      status: 'running',
      progress: 40,
      steps: [],
    };

    render(
      <WorkflowCard
        runId="run_123"
        templateName="测试工作流"
        onCreateScheduledTask={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '创建定时任务' })).toBeNull();
  });

  it('invokes onCreateScheduledTask with workflow id', async () => {
    chatState.workflowCardStates.run_123 = {
      runId: 'run_123',
      workflowId: 'wf_abc',
      status: 'completed',
      progress: 100,
      steps: [],
    };
    const onCreateScheduledTask = vi.fn();

    render(
      <WorkflowCard
        runId="run_123"
        templateName="测试工作流"
        onCreateScheduledTask={onCreateScheduledTask}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '创建定时任务' }));
    expect(onCreateScheduledTask).toHaveBeenCalledWith('wf_abc');
  });

  it('renders every completed workflow artifact as a product card', async () => {
    chatState.workflowCardStates.run_123 = {
      runId: 'run_123',
      workflowId: 'wf_abc',
      status: 'completed',
      progress: 100,
      steps: [],
      result: {
        artifacts: [
          { id: 'art_1', name: '出行报告.html', type: 'text/html', url: 'file:///C:/workflow/出行报告.html' },
          { id: 'art_2', name: '天气数据.json', type: 'application/json', url: 'file:///C:/workflow/天气数据.json' },
        ],
      },
    } as never;

    render(<WorkflowCard runId="run_123" templateName="测试工作流" />);

    expect(await screen.findByText('出行报告.html')).toBeTruthy();
    expect(screen.getByText('天气数据.json')).toBeTruthy();
  });

  it('polls active runs at three seconds and stops after a terminal snapshot', async () => {
    vi.useFakeTimers();
    chatState.workflowCardStates.run_123 = {
      runId: 'run_123',
      workflowId: 'wf_abc',
      status: 'running',
      progress: 40,
      steps: [],
    };
    getChatWorkflowCard
      .mockResolvedValueOnce(chatState.workflowCardStates.run_123)
      .mockResolvedValueOnce({
        ...chatState.workflowCardStates.run_123,
        status: 'completed',
        progress: 100,
      });

    render(<WorkflowCard runId="run_123" templateName="测试工作流" />);
    await act(async () => { await Promise.resolve(); });
    expect(getChatWorkflowCard).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(getChatWorkflowCard).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getChatWorkflowCard).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
