import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { isGlobalToastInteractionTarget } from '@/lib/global-toast-interaction';
import { TestRunDrawer } from '@/pages/WorkflowDesigner/components/test-run-drawer';
import type { WorkflowExecutionState, WorkflowRunResponse, WorkflowRunStatus } from '@/types/workflow';

const previousLanguage = i18n.language;

beforeAll(async () => {
  await i18n.changeLanguage('zh');
});

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

function runtimeFixture(status: WorkflowRunStatus) {
  const run: WorkflowRunResponse = {
    id: 'run-1',
    workflowId: 'wf-1',
    workflowVersion: 7,
    status,
    startedAt: '2026-08-12T10:11:35+08:00',
    completedAt: status === 'completed' ? '2026-08-12T10:12:35+08:00' : null,
    nodeRuns: [],
    events: [
      { id: 'event-1', type: 'agent.started', payload: { message: '流程运行已创建' }, timestamp: '2026-08-12T10:11:35+08:00' },
    ],
    artifacts: status === 'completed'
      ? [{ id: 'artifact-1', name: '对账表.xlsx', type: 'file', url: '/tmp/report.xlsx', filePath: '/tmp/report.xlsx' }]
      : [],
    output: null,
    error: status === 'failed' ? '节点执行失败' : null,
  };
  const executionState: WorkflowExecutionState = {
    runId: run.id,
    workflowId: run.workflowId,
    status,
    progress: status === 'completed' ? 100 : 50,
    steps: [],
    error: run.error ?? undefined,
  };
  return { run, executionState };
}

function renderDrawer(status: WorkflowRunStatus, overrides: Record<string, unknown> = {}) {
  const runtime = runtimeFixture(status);
  const props = {
    variant: 'trial' as const,
    open: true,
    runId: runtime.run.id,
    run: runtime.run,
    executionState: runtime.executionState,
    workflowVersion: 7,
    isStarting: false,
    isCancelling: false,
    isRunActive: ['pending', 'running', 'waiting_approval', 'waiting_input'].includes(status),
    isDraftSnapshot: true,
    launchError: null,
    onClose: vi.fn(),
    onCancel: vi.fn(),
    onContinue: vi.fn(),
    onRerun: vi.fn(),
    onDecideApproval: vi.fn(),
    onSubmitInput: vi.fn(),
    ...overrides,
  };
  return render(<TestRunDrawer {...props} />);
}

describe('TestRunDrawer trial mode', () => {
  it('recognizes completion-toast descendants as protected outside interactions', () => {
    const toaster = document.createElement('div');
    toaster.className = 'sto-global-toaster';
    const action = document.createElement('button');
    toaster.append(action);

    expect(isGlobalToastInteractionTarget(action)).toBe(true);
    expect(isGlobalToastInteractionTarget(document.createElement('button'))).toBe(false);
    expect(isGlobalToastInteractionTarget(null)).toBe(false);
  });

  it('uses the approved 500px running layout and fixed cancel footer', () => {
    renderDrawer('running');

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-[min(500px,100vw)]');
    expect(screen.getByRole('heading', { name: '试运行结果' })).toBeInTheDocument();
    expect(screen.getByText(/关闭弹窗后不会中断运行/)).toBeInTheDocument();
    expect(screen.getByTestId('trial-run-status')).toHaveClass('h-[42px]');
    expect(screen.getByTestId('trial-run-footer')).toHaveClass('h-[60px]');
    expect(screen.getByRole('button', { name: '取消运行' })).toHaveClass('h-9', 'rounded-[10px]');
  });

  it('keeps the title area open and uses the dismissible orange running notice', () => {
    renderDrawer('running');

    expect(screen.getByTestId('trial-run-header')).not.toHaveClass('border-b');
    expect(screen.getByTestId('trial-run-notice')).toHaveClass(
      'border-[#FFD6BA]',
      'bg-[#FFF1E8]',
    );
    expect(screen.getByTestId('trial-run-notice-icon')).toHaveClass('text-[#FF6700]');
    fireEvent.click(screen.getByRole('button', { name: '关闭运行提示' }));
    expect(screen.queryByTestId('trial-run-notice')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each([
    ['running', 'text-[#FF6700]'],
    ['cancelled', 'text-[#FAAD14]'],
    ['failed', 'text-[#FA3C3C]'],
    ['completed', 'text-[#00B54B]'],
  ] as const)('uses the approved semantic color for %s', (status, colorClass) => {
    renderDrawer(status);

    expect(screen.getByTestId('trial-run-status')).toHaveClass(
      'border-[#E5E6EB]',
      'bg-white',
      colorClass,
    );
  });

  it('renders every timeline event with the same grey node and connector', () => {
    const runtime = runtimeFixture('running');
    runtime.run.events.push(
      { id: 'event-2', type: 'node.started', payload: { nodeName: '提醒写日报' }, timestamp: '2026-08-12T10:11:36+08:00' },
      { id: 'event-3', type: 'agent.attempt.start', payload: { attempt: 1 }, timestamp: '2026-08-12T10:11:37+08:00' },
    );
    renderDrawer('running', runtime);

    expect(screen.getAllByTestId('trial-run-timeline-dot')).toHaveLength(3);
    screen.getAllByTestId('trial-run-timeline-dot').forEach((dot) => {
      expect(dot).toHaveClass('bg-[#C9CDD4]');
    });
    expect(screen.getAllByTestId('trial-run-timeline-line')).toHaveLength(2);
  });

  it.each([
    ['cancelled', '运行已取消', '继续运行'],
    ['failed', '运行失败', '重新运行'],
  ] as const)('renders %s with its previous timeline and bottom action', (status, label, action) => {
    renderDrawer(status);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('Agent 开始执行')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
  });

  it('switches completed process between collapsed and expanded views without hiding artifacts', () => {
    renderDrawer('completed');

    expect(screen.queryByTestId('trial-run-process-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('trial-run-artifact-card')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '对账表.xlsx' })).toHaveClass(
      'text-primary',
      'underline',
      'underline-offset-2',
    );
    expect(screen.getByRole('button', { name: '对账表.xlsx' })).toHaveAttribute(
      'title',
      '点击查看附件',
    );
    fireEvent.click(screen.getByRole('button', { name: '展开执行过程' }));
    expect(screen.getByTestId('trial-run-process-card')).toBeInTheDocument();
    expect(screen.getByTestId('trial-run-artifact-card')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起执行过程' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps approval controls inside the running process area', () => {
    renderDrawer('waiting_approval');

    expect(screen.getByText('人工审批')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通过' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
  });

  it('uses the same trial-run presentation for historical details', () => {
    const runtime = runtimeFixture('completed');
    render(<TestRunDrawer
      variant="detail"
      open
      workflowName="历史流程"
      runId={runtime.run.id}
      run={runtime.run}
      executionState={runtime.executionState}
      isStarting={false}
      isCancelling={false}
      isRunActive={false}
      isDraftSnapshot={false}
      launchError={null}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('heading', { name: '试运行结果' })).toBeInTheDocument();
    expect(screen.queryByText('历史流程')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-[min(500px,100vw)]');
  });
});
