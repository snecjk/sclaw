import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { WorkflowCompletionNotifier } from '@/components/workflow/WorkflowCompletionNotifier';
import { subscribeWorkflowResultDrawerHandoff } from '@/lib/workflow-result-drawer-handoff';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  getRunViaIpc: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: vi.fn(),
  },
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: vi.fn((eventName: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(eventName, handler);
    return () => mocks.handlers.delete(eventName);
  }),
}));

vi.mock('@/lib/workflow-api', () => ({
  getRunViaIpc: mocks.getRunViaIpc,
  runToExecutionState: (run: { id: string; workflowId: string; status: string }) => ({
    runId: run.id,
    workflowId: run.workflowId,
    status: run.status,
    progress: 100,
    steps: [],
  }),
}));

vi.mock('@/stores/workflow-memory', () => ({
  getExecutionByRunId: vi.fn(() => ({ templateName: '123' })),
  markCompletionNotificationDelivered: vi.fn(),
}));

function runFixture(runId: string) {
  return {
    id: runId,
    workflowId: 'wf-1',
    workflowVersion: 1,
    status: 'completed',
    nodeRuns: [],
    events: [],
    artifacts: [],
    output: null,
    error: null,
  };
}

function renderNotifier() {
  return render(
    <MemoryRouter>
      <WorkflowCompletionNotifier />
    </MemoryRouter>,
  );
}

function emitCompleted(runId: string) {
  act(() => {
    mocks.handlers.get('workflow:status-update')?.({
      sessionKey: 'designer-try-run',
      runId,
      status: 'completed',
      workflowId: 'wf-1',
    });
  });
}

function clickLatestToastAction() {
  const options = mocks.toastSuccess.mock.calls.at(-1)?.[1] as {
    action?: { onClick: () => void };
  } | undefined;
  expect(options?.action).toBeDefined();
  act(() => options?.action?.onClick());
}

beforeEach(() => {
  mocks.handlers.clear();
  mocks.getRunViaIpc.mockReset();
  mocks.toastSuccess.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('WorkflowCompletionNotifier result drawer handoff', () => {
  it('waits for the matching trial drawer to close before opening details', async () => {
    mocks.getRunViaIpc.mockResolvedValue(runFixture('run-notifier-claimed'));
    let complete: (() => void) | undefined;
    const unsubscribe = subscribeWorkflowResultDrawerHandoff((request) => {
      if (request.runId !== 'run-notifier-claimed') return false;
      complete = request.complete;
      return true;
    });
    renderNotifier();

    emitCompleted('run-notifier-claimed');
    clickLatestToastAction();

    expect(complete).toBeTypeOf('function');
    expect(screen.queryByRole('heading', { name: '运行详情' })).not.toBeInTheDocument();
    expect(mocks.getRunViaIpc).not.toHaveBeenCalled();

    await act(async () => {
      complete?.();
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: '运行详情' })).toBeInTheDocument();
    expect(mocks.getRunViaIpc).toHaveBeenCalledWith('run-notifier-claimed', 'detail');
    unsubscribe();
  });

  it('opens details immediately when no trial drawer claims the run', async () => {
    mocks.getRunViaIpc.mockResolvedValue(runFixture('run-notifier-direct'));
    renderNotifier();

    emitCompleted('run-notifier-direct');
    clickLatestToastAction();

    expect(await screen.findByRole('heading', { name: '运行详情' })).toBeInTheDocument();
    expect(mocks.getRunViaIpc).toHaveBeenCalledWith('run-notifier-direct', 'detail');
  });

  it('uses the same handoff for an OS completion-open event', async () => {
    mocks.getRunViaIpc.mockResolvedValue(runFixture('run-os-claimed'));
    let complete: (() => void) | undefined;
    const unsubscribe = subscribeWorkflowResultDrawerHandoff((request) => {
      if (request.runId !== 'run-os-claimed') return false;
      complete = request.complete;
      return true;
    });
    renderNotifier();

    act(() => {
      mocks.handlers.get('workflow:completion-open')?.({
        sessionKey: 'designer-try-run',
        runId: 'run-os-claimed',
      });
    });

    expect(complete).toBeTypeOf('function');
    expect(mocks.getRunViaIpc).not.toHaveBeenCalled();

    await act(async () => {
      complete?.();
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: '运行详情' })).toBeInTheDocument();
    expect(mocks.getRunViaIpc).toHaveBeenCalledWith('run-os-claimed', 'detail');
    unsubscribe();
  });
});
