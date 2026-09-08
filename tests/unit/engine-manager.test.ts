import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listAgentsSnapshotMock, getEngineSessionRegistryEntryMock, rememberSessionEngineTypeMock } = vi.hoisted(() => ({
  listAgentsSnapshotMock: vi.fn(),
  getEngineSessionRegistryEntryMock: vi.fn(),
  rememberSessionEngineTypeMock: vi.fn(),
}));

vi.mock('../../electron/utils/agent-config', () => ({
  listAgentsSnapshot: (...args: unknown[]) => listAgentsSnapshotMock(...args),
}));

vi.mock('../../electron/engines/openclaw-adapter', () => ({
  openClawAdapter: {
    type: 'openclaw',
    listSessions: vi.fn(),
  },
}));

vi.mock('../../electron/engines/claude-adapter', () => ({
  claudeAdapter: {
    type: 'claude',
    listSessions: vi.fn(),
  },
}));

vi.mock('../../electron/engines/pi-adapter', () => ({
  piAdapter: {
    type: 'pi',
    listSessions: vi.fn(async () => ({ success: true, result: { sessions: [] } })),
  },
}));

vi.mock('../../electron/engines/session-registry', () => ({
  getEngineSessionRegistryEntry: (...args: unknown[]) => getEngineSessionRegistryEntryMock(...args),
}));

vi.mock('../../electron/utils/scheduled-task-poller-store', () => ({
  filterDeletedSessions: async (sessions: unknown[]) => sessions,
}));

vi.mock('../../electron/engines/session-engine', async () => {
  const actual = await vi.importActual<typeof import('../../electron/engines/session-engine')>('../../electron/engines/session-engine');
  return {
    ...actual,
    rememberSessionEngineType: (...args: unknown[]) => rememberSessionEngineTypeMock(...args),
  };
});

describe('engine manager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    rememberSessionEngineTypeMock.mockResolvedValue(undefined);
    getEngineSessionRegistryEntryMock.mockResolvedValue(null);
  });

  it('prefers the remembered engine when the same session key exists in both runtimes', async () => {
    const { openClawAdapter } = await import('../../electron/engines/openclaw-adapter');
    const { claudeAdapter } = await import('../../electron/engines/claude-adapter');

    vi.mocked(openClawAdapter.listSessions).mockResolvedValue({
      success: true,
      result: {
        sessions: [
          { key: 'agent:main:main', label: 'OpenClaw Main', engineType: 'openclaw' },
        ],
      },
    });

    vi.mocked(claudeAdapter.listSessions).mockResolvedValue({
      success: true,
      result: {
        sessions: [
          { key: 'agent:main:main', label: 'Claude Main', engineType: 'claude' },
        ],
      },
    });

    getEngineSessionRegistryEntryMock.mockResolvedValue({
      sessionKey: 'agent:main:main',
      engineType: 'openclaw',
      agentId: 'main',
    });

    const { listEngineSessions } = await import('../../electron/engines/manager');
    const sessions = await listEngineSessions({ gatewayManager: {} as never });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      key: 'agent:main:main',
      label: 'OpenClaw Main',
      engineType: 'openclaw',
    });
    expect(rememberSessionEngineTypeMock).not.toHaveBeenCalled();
  });

  it('resets runtime-specific session binding when switching a session to another engine', async () => {
    vi.doUnmock('../../electron/engines/session-engine');
    vi.doUnmock('../../electron/engines/session-registry');

    const registryState = {
      entry: {
        sessionKey: 'agent:main:main',
        engineType: 'claude' as const,
        agentId: 'main',
        sessionId: 'claude-session-1',
        cwd: '/workspace/main',
        title: 'Old Claude Session',
        model: 'claude-sonnet',
        accountId: 'acc-1',
      },
    };

    vi.doMock('../../electron/engines/session-registry', () => ({
      getEngineSessionRegistryEntry: vi.fn(async () => registryState.entry),
      upsertEngineSessionRegistryEntry: vi.fn(async (entry) => {
        registryState.entry = entry;
      }),
    }));

    const { rememberSessionEngineType } = await import('../../electron/engines/session-engine');
    await rememberSessionEngineType('agent:main:main', 'openclaw');

    expect(registryState.entry).toMatchObject({
      sessionKey: 'agent:main:main',
      engineType: 'openclaw',
      agentId: 'main',
      sessionId: undefined,
      cwd: undefined,
      title: undefined,
      model: 'claude-sonnet',
      accountId: 'acc-1',
    });
  });
});
