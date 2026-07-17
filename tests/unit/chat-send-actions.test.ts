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
vi.mock('@/lib/agent-execution-memory', () => ({
  discardAgentMemoriesForAbnormalTurn: vi.fn(),
}));

import { dispatchChatRequest } from '@/stores/chat/dispatch-chat-request';
import { prepareSendContext } from '@/stores/chat/prepare-send-context';
import { createSendActions } from '@/stores/chat/send-actions';
import { clearSendAttemptLocksForTests } from '@/stores/chat/send-attempt-lock';
import { useGatewayStore } from '@/stores/gateway';
import { clearSessionRunLifecycle } from '@/stores/chat/run-lifecycle';

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
  beforeEach(() => {
    clearSendAttemptLocksForTests();
    clearSessionRunLifecycle('agent:main:main');
    vi.mocked(dispatchChatRequest).mockReset();
    vi.mocked(prepareSendContext).mockReset().mockImplementation(async ({ trimmedText }) => ({
      claudeMemorySystemPrompt: undefined,
      displayText: trimmedText,
      messageWithContext: trimmedText,
    }));
  });

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

  it('allows only one preparation attempt per session', async () => {
    let finishPreparation!: (value: {
      claudeMemorySystemPrompt: undefined;
      displayText: string;
      messageWithContext: string;
    }) => void;
    vi.mocked(prepareSendContext).mockImplementationOnce(() => new Promise((resolve) => {
      finishPreparation = resolve;
    }));
    vi.mocked(dispatchChatRequest).mockResolvedValue({ success: true, result: { runId: 'run-1' } });
    const { actions } = createHarness();

    const first = actions.sendMessage({ text: 'hello' });
    await vi.waitFor(() => expect(prepareSendContext).toHaveBeenCalledTimes(1));
    await actions.sendMessage({ text: 'hello again' });

    expect(prepareSendContext).toHaveBeenCalledTimes(1);
    finishPreparation({
      claudeMemorySystemPrompt: undefined,
      displayText: 'hello',
      messageWithContext: 'hello',
    });
    await first;
    expect(dispatchChatRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps the active run bound when abort RPC fails', async () => {
    const { actions, get } = createHarness();
    get().runtimeBySessionKey['agent:main:main'] = {
      ...createIdleSessionRuntimeState(),
      sending: true,
      activeRunId: 'run-active',
    };
    const rpc = vi.spyOn(useGatewayStore.getState(), 'rpc').mockRejectedValueOnce(new Error('abort failed'));

    const stopped = await actions.abortRun();

    expect(stopped).toBe(false);
    expect(rpc).toHaveBeenCalledWith('chat.abort', expect.objectContaining({
      sessionKey: 'agent:main:main',
    }));
    expect(get().runtimeBySessionKey['agent:main:main']).toMatchObject({
      sending: true,
      aborting: false,
      activeRunId: 'run-active',
      error: 'Error: abort failed',
    });
    rpc.mockRestore();
  });

  it('clears the active run only after abort RPC succeeds', async () => {
    const { actions, get } = createHarness();
    get().runtimeBySessionKey['agent:main:main'] = {
      ...createIdleSessionRuntimeState(),
      sending: true,
      activeRunId: 'run-active',
    };
    const rpc = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValueOnce({});

    const abortPromise = actions.abortRun();
    expect(get().runtimeBySessionKey['agent:main:main']).toMatchObject({
      sending: true,
      aborting: true,
      activeRunId: 'run-active',
    });
    await expect(abortPromise).resolves.toBe(true);

    expect(get().runtimeBySessionKey['agent:main:main']).toMatchObject({
      sending: false,
      aborting: false,
      activeRunId: null,
    });
    rpc.mockRestore();
  });
});
