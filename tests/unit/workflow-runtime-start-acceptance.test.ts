import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => unknown>());
const engine = vi.hoisted(() => ({
  startWorkflow: vi.fn(async () => undefined),
  startRun: vi.fn(),
  resumeRun: vi.fn(),
  cancel: vi.fn(),
  resumeApproval: vi.fn(),
  resumeInput: vi.fn(),
  recover: vi.fn(),
  startSync: vi.fn(),
  stopSync: vi.fn(),
  retrySync: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));
vi.mock('../../electron/services/workflow-runtime/engine', () => ({
  createEngine: () => engine,
}));
vi.mock('../../electron/services/workflow-runtime/id-pool', () => ({
  takeWorkflowDatabaseId: vi.fn(async () => 1),
}));

import { registerWorkflowRuntimeHandlers } from '../../electron/services/workflow-runtime';

function startArgs() {
  return {
    runId: 'run-1',
    runDatabaseId: 101,
    workflowId: 'wf-1',
    versionId: 'version-1',
    input: { city: '上海' },
    startedAt: '2026-08-04T10:00:00+08:00',
    sessionKey: 'agent:main:session-1',
    triggerType: 'chat',
    engineType: 'openclaw',
    engineModel: 'dashscope/qwen3.6-plus',
    chatCard: { title: '天气', paramsSummary: '上海' },
  };
}

describe('workflow runtime durable start acceptance', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('acknowledges only after the minimal run and card metadata are persisted', async () => {
    const repo = {
      getRun: vi.fn(async () => null),
      upsertRun: vi.fn(async () => undefined),
    };
    registerWorkflowRuntimeHandlers({ repo } as never);
    const response = await handlers.get('workflow-runtime:start')?.({}, startArgs());

    expect(response).toEqual({ accepted: true, runId: 'run-1', replay: false });
    expect(repo.upsertRun).toHaveBeenCalledWith(expect.objectContaining({
      run_id: 'run-1',
      session_key: 'agent:main:session-1',
      chat_card_visible: 1,
      chat_card_title: '天气',
    }));
    expect(engine.startWorkflow).toHaveBeenCalledWith(startArgs());
    expect(repo.upsertRun.mock.invocationCallOrder[0]).toBeLessThan(
      engine.startWorkflow.mock.invocationCallOrder[0],
    );
  });

  it('rejects persistence failure without launching the engine', async () => {
    const repo = {
      getRun: vi.fn(async () => null),
      upsertRun: vi.fn(async () => { throw new Error('sqlite unavailable'); }),
    };
    registerWorkflowRuntimeHandlers({ repo } as never);
    const response = await handlers.get('workflow-runtime:start')?.({}, startArgs());

    expect(response).toEqual({ accepted: false, runId: 'run-1', error: 'sqlite unavailable' });
    expect(engine.startWorkflow).not.toHaveBeenCalled();
  });

  it('replays an identical durable run and rejects an identity conflict', async () => {
    const repo = {
      getRun: vi.fn()
        .mockResolvedValueOnce({
          run_id: 'run-1', workflow_id: 'wf-1', version_id: 'version-1', session_key: 'agent:main:session-1',
        })
        .mockResolvedValueOnce({
          run_id: 'run-1', workflow_id: 'wf-other', version_id: 'version-1', session_key: 'agent:main:session-1',
        }),
      upsertRun: vi.fn(),
    };
    registerWorkflowRuntimeHandlers({ repo } as never);
    const handler = handlers.get('workflow-runtime:start');

    await expect(handler?.({}, startArgs())).resolves.toEqual({
      accepted: true, runId: 'run-1', replay: true,
    });
    await expect(handler?.({}, startArgs())).resolves.toEqual({
      accepted: false,
      runId: 'run-1',
      error: 'workflow runId is already bound to a different workflow identity',
    });
    expect(engine.startWorkflow).not.toHaveBeenCalled();
  });
});
