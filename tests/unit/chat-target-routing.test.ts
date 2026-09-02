import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeIpcMock, hostApiFetchMock, agentsState, bindSessionMock, fetchAgentsMock } = vi.hoisted(() => ({
  invokeIpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  bindSessionMock: vi.fn(),
  fetchAgentsMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    fetchAgents: null as unknown as () => Promise<void>,
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

vi.mock('@/stores/session-catalog', () => ({
  useSessionCatalogStore: {
    getState: () => ({ bindSession: bindSessionMock }),
    setState: vi.fn(),
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
    agentsState.fetchAgents = fetchAgentsMock;
    fetchAgentsMock.mockReset();
    fetchAgentsMock.mockResolvedValue(undefined);

    invokeIpcMock.mockReset();
    invokeIpcMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'chat-runtime:listActive') return [];
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
      if (channel === 'session-catalog:invoke') {
        const [request] = args as [{ action?: string }];
        if (request?.action === 'ensureProjectAgent') {
          return {
            agentId: 'proj-project-a--main',
            created: true,
            workspaceUpdated: false,
          };
        }
      }
      throw new Error(`Unexpected invokeIpc call: ${channel}`);
    });

    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/chat/send') {
        return { success: true, result: { runId: 'run-send' } };
      }
      if (path === '/api/sessions/model') {
        return { success: true };
      }
      throw new Error(`Unexpected hostApiFetch call: ${path}`);
    });
    bindSessionMock.mockReset();
    bindSessionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches to the selected agent main session before sending text', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { getSessionDisplayMessages } = await import('@/stores/chat/display-selectors');
    const { useChatRuntimeV2Store } = await import('@/stores/chat/runtime-v2-store');

    useChatRuntimeV2Store.getState().clearSession('agent:main:main');
    useChatRuntimeV2Store.getState().clearSession('agent:research:desk');
    useChatRuntimeV2Store.getState().setTranscript('agent:main:main', [
      { role: 'assistant', content: 'Existing main history' },
    ]);

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
    expect(getSessionDisplayMessages('agent:research:desk').at(-1)?.content).toBe('Hello direct agent');
    const historyCall = invokeIpcMock.mock.calls.find(
      ([channel, method]) => channel === 'gateway:rpc' && method === 'chat.history',
    );
    expect(historyCall?.[2]).toEqual({ sessionKey: 'agent:research:desk', engineType: 'openclaw' });

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

  it('loads older history from any adapter that declares before-id pagination', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { useChatRuntimeV2Store } = await import('@/stores/chat/runtime-v2-store');
    const { createClientSessionState } = await import('@/stores/chat/client-session-reducer');
    const sessionKey = 'pi:main:paged-history';
    const latest = Array.from({ length: 50 }, (_, index) => ({
      id: `m${index + 10}`,
      role: 'assistant' as const,
      content: String(index + 10),
      timestamp: index + 10,
    }));
    useChatRuntimeV2Store.setState((state) => ({
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...createClientSessionState(),
          transcript: latest,
          historyTotalCount: 60,
          historyCapabilities: { paginationMode: 'before-id', defaultPageSize: 50 },
        },
      },
    }));
    useChatStore.setState({
      currentSessionKey: sessionKey,
      currentAgentId: 'main',
      sessions: [{ key: sessionKey, engineType: 'pi' }],
      loading: false,
    });
    invokeIpcMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel !== 'gateway:rpc' || args[0] !== 'chat.history') {
        throw new Error(`Unexpected invokeIpc call: ${channel}`);
      }
      return {
        success: true,
        result: {
          messages: Array.from({ length: 10 }, (_, index) => ({
            id: `m${index}`,
            role: index === 0 ? 'user' : 'assistant',
            content: String(index),
            timestamp: index,
          })),
          totalCount: 60,
          hasMore: false,
          historyCapabilities: { paginationMode: 'before-id', defaultPageSize: 50 },
        },
      };
    });

    await useChatStore.getState().loadOlderHistory(sessionKey);

    const historyCall = invokeIpcMock.mock.calls.find(
      ([channel, method]) => channel === 'gateway:rpc' && method === 'chat.history',
    );
    expect(historyCall?.[2]).toEqual({
      sessionKey,
      limit: 50,
      beforeId: 'm10',
      engineType: 'pi',
    });
    const transcript = useChatRuntimeV2Store.getState().sessionsByKey[sessionKey]?.transcript ?? [];
    expect(transcript).toHaveLength(60);
    expect(transcript[0]?.id).toBe('m0');
  });

  it('materializes and binds a project draft before its first dispatch', async () => {
    const { useChatStore } = await import('@/stores/chat');
    let bindingCompleted = false;
    bindSessionMock.mockImplementation(async () => {
      bindingCompleted = true;
    });

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      pendingProjectId: null,
      pendingNewSessionModel: 'dashscope/test-model',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
      loading: false,
    });

    useChatStore.getState().newSession({ projectId: 'project-a' });
    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'proj-project-a--main',
      pendingProjectId: 'project-a',
    });
    expect(useChatStore.getState().sessions).toEqual([]);

    await useChatStore.getState().sendMessage({ text: 'Project first message' });

    const materializedKey = useChatStore.getState().currentSessionKey;
    expect(materializedKey).toMatch(/^agent:proj-project-a--main:session-/);
    expect(useChatStore.getState().pendingProjectId).toBeNull();
    expect(bindSessionMock).toHaveBeenCalledWith(materializedKey, 'project-a');
    expect(bindingCompleted).toBe(true);

    const sendCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/chat/send');
    const payload = JSON.parse((sendCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      sessionKey: materializedKey,
      message: 'Project first message',
    });
  });

  it('uses the selected agent main session for attachment sends', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
