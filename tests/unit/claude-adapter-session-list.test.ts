import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from '../../electron/engines/claude-adapter';
import {
  getEngineSessionRegistryEntry,
  listEngineSessionRegistryEntries,
  upsertEngineSessionRegistryEntry,
} from '../../electron/engines/session-registry';
import {
  ensureClaudeRuntimeReady,
  getClaudeSessionMessages,
} from '../../electron/engines/claude-sdk-runtime';

vi.mock('../../electron/engines/session-registry', () => ({
  deleteEngineSessionRegistryEntry: vi.fn(),
  getEngineSessionRegistryEntry: vi.fn(),
  listEngineSessionRegistryEntries: vi.fn(),
  patchEngineSessionRegistryEntry: vi.fn(),
  upsertEngineSessionRegistryEntry: vi.fn(),
}));

vi.mock('../../electron/engines/claude-sdk-runtime', () => ({
  createClaudeQuery: vi.fn(),
  deleteClaudeSdkSession: vi.fn(),
  ensureClaudeRuntimeReady: vi.fn(),
  getClaudeSessionMessages: vi.fn(),
  prepareClaudeRuntime: vi.fn(),
  resolveClaudeLaunchSelection: vi.fn(),
}));

const engineContext = { gatewayManager: {} as never };

describe('claude adapter SQLite session metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureClaudeRuntimeReady).mockResolvedValue();
  });

  it('lists sessions in SQLite order without reading or healing transcripts', async () => {
    vi.mocked(listEngineSessionRegistryEntries).mockResolvedValue([
      {
        sessionKey: 'agent:main:session:newer',
        sessionId: 'sdk-newer',
        cwd: 'D:\\workspace',
        agentId: 'main',
        engineType: 'claude',
        updatedAt: 200,
        title: 'Newer',
        model: 'model-a',
      },
      {
        sessionKey: 'agent:main:session:older',
        sessionId: 'sdk-older',
        cwd: 'D:\\workspace',
        agentId: 'main',
        engineType: 'claude',
        updatedAt: 100,
        title: 'Older',
        model: 'model-b',
      },
    ]);

    const result = await claudeAdapter.listSessions(engineContext);

    expect(result).toEqual({
      success: true,
      result: {
        sessions: [
          {
            key: 'agent:main:session:newer',
            label: 'Newer',
            displayName: 'Newer',
            updatedAt: 200,
            model: 'model-a',
            engineType: 'claude',
          },
          {
            key: 'agent:main:session:older',
            label: 'Older',
            displayName: 'Older',
            updatedAt: 100,
            model: 'model-b',
            engineType: 'claude',
          },
        ],
      },
    });
    expect(ensureClaudeRuntimeReady).not.toHaveBeenCalled();
    expect(getClaudeSessionMessages).not.toHaveBeenCalled();
    expect(upsertEngineSessionRegistryEntry).not.toHaveBeenCalled();
  });

  it('keeps getHistory read-only with respect to SQLite activity metadata', async () => {
    vi.mocked(getEngineSessionRegistryEntry).mockResolvedValue({
      sessionKey: 'agent:main:session:history',
      sessionId: 'sdk-history',
      cwd: 'D:\\workspace',
      agentId: 'main',
      engineType: 'claude',
      updatedAt: 123,
    });
    vi.mocked(getClaudeSessionMessages).mockResolvedValue([]);

    const result = await claudeAdapter.getHistory(engineContext, {
      sessionKey: 'agent:main:session:history',
      limit: 50,
    });

    expect(result.success).toBe(true);
    expect(getClaudeSessionMessages).toHaveBeenCalledTimes(1);
    expect(upsertEngineSessionRegistryEntry).not.toHaveBeenCalled();
  });
});
