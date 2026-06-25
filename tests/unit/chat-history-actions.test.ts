import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();
const hostApiFetchMock = vi.fn();
const clearHistoryPoll = vi.fn();
const enrichWithCachedImages = vi.fn((messages) => messages);
const enrichWithToolResultFiles = vi.fn((messages) => messages);
const getMessageText = vi.fn((content: unknown) => typeof content === 'string' ? content : '');
const hasNonToolAssistantContent = vi.fn((message: { content?: unknown } | undefined) => {
  if (!message) return false;
  return typeof message.content === 'string' ? message.content.trim().length > 0 : true;
});
const isToolResultRole = vi.fn((role: unknown) => role === 'toolresult' || role === 'tool_result');
const loadMissingPreviews = vi.fn(async () => false);
const toMs = vi.fn((ts: number) => ts < 1e12 ? ts * 1000 : ts);

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/chat/helpers', () => ({
  clearHistoryPoll: (...args: unknown[]) => clearHistoryPoll(...args),
  enrichWithCachedImages: (...args: unknown[]) => enrichWithCachedImages(...args),
  enrichWithToolResultFiles: (...args: unknown[]) => enrichWithToolResultFiles(...args),
  getMessageText: (...args: unknown[]) => getMessageText(...args),
  hasNonToolAssistantContent: (...args: unknown[]) => hasNonToolAssistantContent(...args),
  isToolResultRole: (...args: unknown[]) => isToolResultRole(...args),
  loadMissingPreviews: (...args: unknown[]) => loadMissingPreviews(...args),
  toMs: (...args: unknown[]) => toMs(...args as Parameters<typeof toMs>),
}));

type ChatLikeState = {
  currentSessionKey: string;
  sessions: Array<{ key: string; engineType?: 'openclaw' | 'claude' }>;
  messages: Array<{ role: string; timestamp?: number; content?: unknown; _attachedFiles?: unknown[]; isError?: boolean }>;
  loading: boolean;
  error: string | null;
  sending: boolean;
  lastUserMessageAt: number | null;
  pendingFinal: boolean;
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
  thinkingLevel: string | null;
  activeRunId: string | null;
};

function makeHarness(initial?: Partial<ChatLikeState>) {
  let state: ChatLikeState = {
    currentSessionKey: 'agent:main:main',
    sessions: [{ key: 'agent:main:main', engineType: 'openclaw' }],
    messages: [],
    loading: false,
    error: null,
    sending: false,
    lastUserMessageAt: null,
    pendingFinal: false,
    sessionLabels: {},
    sessionLastActivity: {},
    thinkingLevel: null,
    activeRunId: null,
    ...initial,
  };

  const set = (partial: Partial<ChatLikeState> | ((s: ChatLikeState) => Partial<ChatLikeState>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get, read: () => state };
}

describe('chat history actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invokeIpcMock.mockResolvedValue({ success: true, result: { messages: [] } });
    hostApiFetchMock.mockResolvedValue({ success: true, result: { messages: [] } });
  });

  it('uses cron session fallback when gateway history is empty', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:cron:job-1',
      sessions: [{ key: 'agent:main:cron:job-1', engineType: 'openclaw' }],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      result: { messages: [] },
    });
    hostApiFetchMock.mockResolvedValueOnce({
      messages: [
        {
          id: 'cron-meta-job-1',
          role: 'system',
          content: 'Scheduled task: Drink water',
          timestamp: 1773281731495,
        },
        {
          id: 'cron-run-1',
          role: 'assistant',
          content: 'Drink water 💧',
          timestamp: 1773281732751,
        },
      ],
    });

    await actions.loadHistory();

    expect(hostApiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/chat/history?sessionKey=agent%3Amain%3Acron%3Ajob-1&limit=1000&engineType=openclaw',
    );
    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/cron/session-history?sessionKey=agent%3Amain%3Acron%3Ajob-1&limit=50',
    );
    expect(h.read().messages.map((message) => message.content)).toEqual([
      'Scheduled task: Drink water',
      'Drink water 💧',
    ]);
    expect(h.read().sessionLastActivity['agent:main:cron:job-1']).toBe(1773281732751);
    expect(h.read().loading).toBe(false);
  });

  it('does not use cron fallback for normal sessions', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main', engineType: 'openclaw' }],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    await actions.loadHistory();

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/chat/history?sessionKey=agent%3Amain%3Amain&limit=1000&engineType=openclaw',
    );
    expect(h.read().messages).toEqual([]);
    expect(h.read().loading).toBe(false);
  });

  it('preserves failed optimistic user message when history has not caught up', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      error: 'session file locked',
      sending: false,
      lastUserMessageAt: 1710000000000,
      messages: [
        {
          id: 'local-user-1',
          role: 'user',
          content: '怎么没内容了',
          timestamp: 1710000000,
          isError: true,
        },
      ] as never,
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'older assistant message',
            timestamp: 1709999990,
          },
        ],
      },
    });

    await actions.loadHistory(true);

    expect(h.read().messages.map((message) => message.content)).toEqual([
      'older assistant message',
      '怎么没内容了',
    ]);
    expect(h.read().messages[1]?.isError).toBe(true);
  });

  it('does not duplicate optimistic user message when loaded history already has matching text', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sending: true,
      lastUserMessageAt: 1710000000000,
      messages: [
        {
          id: 'local-user-1',
          role: 'user',
          content: '你是谁',
          timestamp: 1710000000,
        },
      ] as never,
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          {
            id: 'history-user-1',
            role: 'user',
            content: '你是谁',
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '我是 S Claw。',
            timestamp: 1710000003,
          },
        ],
      },
    });

    await actions.loadHistory(true);

    expect(h.read().messages.map((message) => message.content)).toEqual([
      '你是谁',
      '我是 S Claw。',
    ]);
  });

  it('inserts preserved optimistic user message before newer assistant history', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sending: true,
      lastUserMessageAt: 1710000000000,
      messages: [
        {
          id: 'local-user-1',
          role: 'user',
          content: '你是谁',
          timestamp: 1710000000,
        },
      ] as never,
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '我是 S Claw。',
            timestamp: 1710000003,
          },
        ],
      },
    });

    await actions.loadHistory(true);

    expect(h.read().messages.map((message) => message.content)).toEqual([
      '你是谁',
      '我是 S Claw。',
    ]);
  });

  it('does not duplicate optimistic user message when server timestamp is skewed', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sending: true,
      lastUserMessageAt: 1710000000000,
      messages: [
        {
          id: 'local-user-1',
          role: 'user',
          content: '你现在是那个模型？',
          timestamp: 1710000000,
        },
      ] as never,
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          {
            id: 'history-user-1',
            role: 'user',
            content: '你现在是那个模型？',
            timestamp: 1700000000,
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '我是 Claude。',
            timestamp: 1710000003,
          },
        ],
      },
    });

    await actions.loadHistory(true);

    expect(h.read().messages.map((message) => message.content)).toEqual([
      '你现在是那个模型？',
      '我是 Claude。',
    ]);
  });

  it('preserves a repeated identical user message separated by an assistant reply', async () => {
    // Regression for "identical input overwrites previous output": two distinct
    // sends of the same text must both be kept. The assistant reply between them
    // proves they are separate turns, not an optimistic/server echo pair (echo
    // reconciliation is mergeOptimisticUserIntoHistory's job, not this dedupe's).
    const { dedupeRedundantUserMessages } = await import('@/stores/chat/user-message-merge');
    const messages = [
      { id: 'user-1', role: 'user', content: '你现在是那个模型？', timestamp: 1710000000 },
      { id: 'assistant-1', role: 'assistant', content: '我是 Claude。', timestamp: 1710000003 },
      { id: 'user-2', role: 'user', content: '你现在是那个模型？', timestamp: 1710000010 },
    ] as never;

    const deduped = dedupeRedundantUserMessages(messages, 1710000010000);

    expect(deduped.map((message) => message.content)).toEqual([
      '你现在是那个模型？',
      '我是 Claude。',
      '你现在是那个模型？',
    ]);
  });
});
