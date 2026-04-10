import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeIpcMock, hostApiFetchMock, agentsState } = vi.hoisted(() => ({
  invokeIpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => agentsState,
  },
}));

describe('chat target routing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    window.localStorage.clear();

    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
      },
    ];

    invokeIpcMock.mockReset();
    invokeIpcMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'gateway:rpc') {
        const [method] = args as [string];
        if (method === 'chat.history') {
          return { success: true, result: { messages: [] } };
        }
        if (method === 'chat.send') {
          return { success: true, result: { runId: 'run-text' } };
        }
        if (method === 'chat.abort') {
          return { success: true, result: { ok: true } };
        }
        if (method === 'sessions.list') {
          return { success: true, result: { sessions: [] } };
        }
      }
      if (channel === 'chat:sendWithMedia') {
        return { success: true, result: { runId: 'run-media' } };
      }
      throw new Error(`Unexpected invokeIpc call: ${channel}`);
    });

    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/token-quota/check') {
        return { allowed: true, used: 0, limit: 100 };
      }
      if (path === '/api/chat/send-with-media') {
        return { success: true, result: { runId: 'run-media' } };
      }
      throw new Error(`Unexpected hostApiFetch call: ${path}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches to the selected agent main session before sending text', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [{ role: 'assistant', content: 'Existing main history' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().sendMessage('Hello direct agent', undefined, 'research');

    const state = useChatStore.getState();
    expect(state.currentSessionKey).toBe('agent:research:desk');
    expect(state.currentAgentId).toBe('research');
    expect(state.sessions.some((session) => session.key === 'agent:research:desk')).toBe(true);
    expect(state.messages.at(-1)?.content).toBe('Hello direct agent');

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/token-quota/check');

    const historyCall = invokeIpcMock.mock.calls.find(
      ([channel, method]) => channel === 'gateway:rpc' && method === 'chat.history',
    );
    expect(historyCall?.[2]).toEqual({ sessionKey: 'agent:research:desk', limit: 200 });

    const sendCall = invokeIpcMock.mock.calls.find(
      ([channel, method]) => channel === 'gateway:rpc' && method === 'chat.send',
    );
    expect(sendCall?.[2]).toMatchObject({
      sessionKey: 'agent:research:desk',
      message: 'Hello direct agent',
      deliver: false,
    });
    expect(typeof (sendCall?.[2] as { idempotencyKey?: unknown })?.idempotencyKey).toBe('string');
  });

  it('uses the selected agent main session for attachment sends', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().sendMessage(
      '',
      [
        {
          fileName: 'design.png',
          mimeType: 'image/png',
          fileSize: 128,
          stagedPath: '/tmp/design.png',
          preview: 'data:image/png;base64,abc',
        },
      ],
      'research',
    );

    expect(useChatStore.getState().currentSessionKey).toBe('agent:research:desk');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/token-quota/check');

    const mediaCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/chat/send-with-media');
    expect(mediaCall?.[1]).toMatchObject({
      method: 'POST',
      body: expect.any(String),
    });

    const payload = JSON.parse((mediaCall?.[1] as { body: string }).body) as {
      sessionKey: string;
      message: string;
      media: Array<{ filePath: string }>;
    };
    expect(payload.sessionKey).toBe('agent:research:desk');
    expect(payload.message).toBe('Process the attached file(s).');
    expect(payload.media[0]?.filePath).toBe('/tmp/design.png');
  });

  it('blocks send when the daily token quota is exhausted', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ allowed: false, used: 1200, limit: 1200 });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().sendMessage('Blocked by quota');

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.error).toContain('1200/1200');
    expect(invokeIpcMock.mock.calls.some(([channel, method]) => channel === 'gateway:rpc' && method === 'chat.send')).toBe(false);
    expect(invokeIpcMock.mock.calls.some(([channel]) => channel === 'chat:sendWithMedia')).toBe(false);
    expect(hostApiFetchMock.mock.calls.some(([path]) => path === '/api/chat/send-with-media')).toBe(false);
  });

  it('fails open when the quota check errors', async () => {
    hostApiFetchMock.mockRejectedValueOnce(new Error('quota check unavailable'));

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().sendMessage(
      '',
      [
        {
          fileName: 'design.png',
          mimeType: 'image/png',
          fileSize: 128,
          stagedPath: '/tmp/design.png',
          preview: 'data:image/png;base64,abc',
        },
      ],
    );

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/token-quota/check');

    const mediaCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/chat/send-with-media');
    expect(mediaCall?.[1]).toMatchObject({
      method: 'POST',
      body: expect.any(String),
    });

    const payload = JSON.parse((mediaCall?.[1] as { body: string }).body) as {
      sessionKey: string;
      message: string;
      media: Array<{ filePath: string }>;
    };
    expect(payload.sessionKey).toBe('agent:main:main');
    expect(payload.message).toBe('Process the attached file(s).');
    expect(payload.media[0]?.filePath).toBe('/tmp/design.png');
  });
});
