import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialChatDataState } from '@/stores/chat/initial-state';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';
import type { ChatState } from '@/stores/chat/types';
import type { ChatSet } from '@/stores/chat/store-api';

vi.mock('@/stores/chat/resolve-send-target', () => ({
  resolveSendTarget: vi.fn(async () => ({
    sessionKey: 'agent:main:main',
    engineType: 'openclaw',
    dingTalkRpcExtras: {},
  })),
}));
vi.mock('@/stores/chat/prepare-send-context', () => ({
  prepareSendContext: vi.fn(async ({ trimmedText }: { trimmedText: string }) => ({
    claudeMemorySystemPrompt: undefined,
    displayText: trimmedText,
    messageWithContext: trimmedText,
  })),
}));
vi.mock('@/stores/chat/optimistic-turn', () => ({
  insertOptimisticUserTurn: vi.fn(() => ({ id: 'message-1', role: 'user', content: 'hello' })),
}));
vi.mock('@/stores/chat/send-watchdogs', () => ({ scheduleSendWatchdogs: vi.fn() }));
vi.mock('@/stores/chat/media-preview-cache', () => ({ cacheUploadedAttachments: vi.fn() }));
vi.mock('@/stores/chat/dispatch-chat-request', () => ({ dispatchChatRequest: vi.fn() }));

import { dispatchChatRequest } from '@/stores/chat/dispatch-chat-request';
import { createSendActions } from '@/stores/chat/send-actions';

function createHarness() {
  let state = {
    ...initialChatDataState,
    newSession: vi.fn(),
    runtimeBySessionKey: {
      'agent:main:main': createIdleSessionRuntimeState(),
    },
  } as ChatState;
  const get = () => state;
  const set: ChatSet = (partial) => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const actions = createSendActions(set, get, {
    normalizeSendMessageOptions: () => ({ text: 'hello' }),
    resolveMainSessionKeyForAgent: () => null,
    buildSessionSwitchPatch: () => ({}),
    resolveEngineTypeForSession: () => 'openclaw',
    clearErrorRecoveryTimer: vi.fn(),
    clearHistoryPoll: vi.fn(),
    setHistoryPollTimer: vi.fn(),
    clearStuckCheckTimer: vi.fn(),
    setStuckCheckTimer: vi.fn(),
  });
  return { actions, get };
}

describe('chat send action acceptance state', () => {
  beforeEach(() => vi.mocked(dispatchChatRequest).mockReset());

  it('fails immediately on an explicit Gateway rejection', async () => {
    vi.mocked(dispatchChatRequest).mockResolvedValue({ success: false, error: 'rejected' });
    const { actions, get } = createHarness();

    await actions.sendMessage({ text: 'hello' });

    expect(get().runtimeBySessionKey['agent:main:main']).toMatchObject({
      sending: false,
      sendAcceptance: null,
      error: 'rejected',
    });
  });
});
