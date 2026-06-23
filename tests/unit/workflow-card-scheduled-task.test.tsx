import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkflowCard } from '@/components/workflow/WorkflowCard';

const { chatState } = vi.hoisted(() => ({
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
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/lib/workflow-run-hydration', () => ({
  hydrateWorkflowRun: vi.fn(),
}));

vi.mock('@/stores/workflow-memory', () => ({
  getExecutionByRunId: vi.fn(() => null),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('WorkflowCard scheduled task action', () => {
  beforeEach(() => {
    chatState.workflowCardStates = {};
  });

  it('shows create scheduled task action for completed workflow with workflow id', () => {
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
        onViewWorkflow={vi.fn()}
        onCreateScheduledTask={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '创建定时任务' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看工作流' })).toBeTruthy();
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
        onViewWorkflow={vi.fn()}
        onCreateScheduledTask={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '创建定时任务' })).toBeNull();
  });

  it('invokes onCreateScheduledTask with workflow id', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '创建定时任务' }));
    expect(onCreateScheduledTask).toHaveBeenCalledWith('wf_abc');
  });
});
