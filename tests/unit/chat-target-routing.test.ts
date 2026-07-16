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
        workspace: '~/.stoclaw/openclaw/workspace',
        agentDir: '~/.stoclaw/openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.stoclaw/openclaw/workspace-research',
        agentDir: '~/.stoclaw/openclaw/agents/research/agent',
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
      if (path === '/api/chat/send') {
        return { success: true, result: { runId: 'run-send' } };
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
    const historyCall = invokeIpcMock.mock.calls.find(
      ([channel, method]) => channel === 'gateway:rpc' && method === 'chat.history',
    );
    expect(historyCall?.[2]).toEqual({ sessionKey: 'agent:research:desk', limit: 1000, engineType: 'openclaw' });

    const sendCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/chat/send');
    expect(sendCall?.[1]).toMatchObject({
      method: 'POST',
      body: expect.any(String),
    });
    const payload = JSON.parse((sendCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      sessionKey: 'agent:research:desk',
      message: 'Hello direct agent',
      deliver: false,
      engineType: 'openclaw',
    });
    expect(typeof payload.idempotencyKey).toBe('string');
  });

  it('keeps a newly-created dialog when sending with its owning agent selected', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const newSessionKey = 'agent:research:session-1770000000000-unique';

    useChatStore.setState({
      currentSessionKey: newSessionKey,
      currentAgentId: 'research',
      sessions: [{ key: newSessionKey, engineType: 'claude' }],
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

    await useChatStore.getState().sendMessage('First message', undefined, 'research');

    expect(useChatStore.getState().currentSessionKey).toBe(newSessionKey);
    const sendCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/chat/send');
    const payload = JSON.parse((sendCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      sessionKey: newSessionKey,
      message: 'First message',
      engineType: 'claude',
    });
    expect(invokeIpcMock.mock.calls.some(
      ([channel, method]) => channel === 'gateway:rpc' && method === 'chat.history',
    )).toBe(false);
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
    const mediaCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/chat/send');
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
    expect(payload.message).toBe('');
    expect(payload.media[0]?.filePath).toBe('/tmp/design.png');
  });

});
