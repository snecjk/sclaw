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

  it('does not expose context usage or manual compaction capabilities', () => {
    expect(claudeAdapter.chatCapabilities).toMatchObject({
      supportsContextUsage: false,
      supportsManualCompaction: false,
    });
    expect(claudeAdapter.getContextUsage).toBeUndefined();
    expect(claudeAdapter.compactSession).toBeUndefined();
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

  it('hides Claude local compact commands and compact summaries from history', async () => {
    vi.mocked(getEngineSessionRegistryEntry).mockResolvedValue({
      sessionKey: 'agent:main:session:compact-history',
      sessionId: 'sdk-compact-history',
      cwd: 'D:\\workspace',
      agentId: 'main',
      engineType: 'claude',
      updatedAt: 123,
    });
    vi.mocked(getClaudeSessionMessages).mockResolvedValue([
      {
        type: 'user',
        uuid: 'command',
        message: { content: [{ type: 'text', text: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>' }] },
      },
      {
        type: 'user',
        uuid: 'summary',
        isVisibleInTranscriptOnly: true,
        isCompactSummary: true,
        message: { content: [{ type: 'text', text: 'This session is being continued from a previous conversation that ran out of context.' }] },
      },
      {
        type: 'user',
        uuid: 'stdout',
        message: { content: [{ type: 'text', text: '<local-command-stdout>Compacted</local-command-stdout>' }] },
      },
      {
        type: 'user',
        uuid: 'visible',
        message: { content: [{ type: 'text', text: 'real question' }] },
      },
    ] as never);

    const result = await claudeAdapter.getHistory(engineContext, {
      sessionKey: 'agent:main:session:compact-history',
      limit: 50,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.messages).toHaveLength(1);
    expect(result.result.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'real question' }],
    });
  });
});
