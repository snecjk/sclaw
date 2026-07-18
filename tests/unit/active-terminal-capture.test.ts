import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();
const hostApiFetchMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('active terminal events', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    invokeIpcMock.mockImplementation(async (channel: string, methodOrPayload?: unknown) => {
      if (channel === 'gateway:rpc' && methodOrPayload === 'chat.history') {
        return { success: true, result: { messages: [] } };
      }
      return { success: true };
    });
    hostApiFetchMock.mockResolvedValue({ success: true });
  });

  it('finalizes UI state without dispatching renderer memory IPC', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const sessionKey = 'agent:claude:main';

    useChatStore.setState({
      currentSessionKey: sessionKey,
      currentAgentId: 'claude',
      sessions: [{ key: sessionKey, engineType: 'claude' }],
      messages: [{ role: 'user', content: 'hello', id: 'user-1' }],
      sending: true,
      activeRunId: 'run-1',
      runtimeBySessionKey: {
        [sessionKey]: {
          sending: true,
          activeRunId: 'run-1',
          sendAcceptance: null,
          streamingText: '',
          streamingMessage: null,
          streamingMessages: [],
          streamingToolResults: [],
          streamingTools: [],
          pendingFinal: false,
          lastUserMessageAt: null,
          optimisticUserMessage: null,
          pendingToolImages: [],
          error: null,
          updatedAt: Date.now(),
        },
      },
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-1',
      sessionKey,
      phase: 'completed',
      message: {
        role: 'assistant',
        id: 'assistant-1',
        content: [{ type: 'text', text: 'done' }],
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    const captureCalls = invokeIpcMock.mock.calls.filter(([channel]) => channel === 'agent-memory:capture');
    const bindCalls = invokeIpcMock.mock.calls.filter(([channel]) => channel === 'execution-memory:bind-injected-memories');
    expect(captureCalls).toHaveLength(0);
    expect(bindCalls).toHaveLength(0);
    expect(useChatStore.getState().runtimeBySessionKey[sessionKey]?.sending).toBe(false);
    expect(useChatStore.getState().runtimeBySessionKey[sessionKey]?.activeRunId).toBeNull();
  });
});
