import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialChatDataState } from '@/stores/chat/initial-state';
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
    displayText: trimmedText,
    messageWithContext: trimmedText,
  })),
}));
vi.mock('@/stores/chat/optimistic-turn', () => ({
  insertOptimisticUserTurn: vi.fn(() => ({ id: 'message-1', role: 'user', content: 'hello' })),
}));
vi.mock('@/stores/chat/media-preview-cache', () => ({ cacheUploadedAttachments: vi.fn() }));
vi.mock('@/stores/chat/dispatch-chat-request', () => ({ dispatchChatRequest: vi.fn() }));

import { dispatchChatRequest } from '@/stores/chat/dispatch-chat-request';
import { prepareSendContext } from '@/stores/chat/prepare-send-context';
import { createSendActions } from '@/stores/chat/send-actions';
import { clearSendAttemptLocksForTests } from '@/stores/chat/send-attempt-lock';
import { useGatewayStore } from '@/stores/gateway';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';

function createHarness() {
  let state = {
    ...initialChatDataState,
    newSession: vi.fn(),
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
  });
  return { actions, get };
}

describe('chat send action acceptance state', () => {
  beforeEach(() => {
    clearSendAttemptLocksForTests();
    useChatRuntimeV2Store.setState({ sessionsByKey: {}, initialized: true });
    vi.mocked(dispatchChatRequest).mockReset();
    vi.mocked(prepareSendContext).mockReset().mockImplementation(async ({ trimmedText }) => ({
      displayText: trimmedText,
      messageWithContext: trimmedText,
    }));
  });

  it('fails immediately on an explicit Gateway rejection', async () => {
    vi.mocked(dispatchChatRequest).mockResolvedValue({ success: false, error: 'rejected' });
    const { actions } = createHarness();

    await actions.sendMessage({ text: 'hello' });

    expect(dispatchChatRequest).toHaveBeenCalledTimes(1);
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
    const { actions } = createHarness();
    const session = createClientSessionState();
    session.runtime = {
      phase: 'running', runId: 'run-active', idempotencyKey: 'message-1', engineType: 'openclaw',
      epoch: 1, sequence: 1, startedAt: 1, lastEventAt: 1,
    };
    useChatRuntimeV2Store.setState({ sessionsByKey: { 'agent:main:main': session } });
    const rpc = vi.spyOn(useGatewayStore.getState(), 'rpc').mockRejectedValueOnce(new Error('abort failed'));

    const stopped = await actions.abortRun();

    expect(stopped).toBe(false);
    expect(rpc).toHaveBeenCalledWith('chat.abort', expect.objectContaining({
      sessionKey: 'agent:main:main',
    }));
    expect(useChatRuntimeV2Store.getState().sessionsByKey['agent:main:main']?.runtime?.runId).toBe('run-active');
    rpc.mockRestore();
  });

  it('clears the active run only after abort RPC succeeds', async () => {
    const { actions } = createHarness();
    const session = createClientSessionState();
    session.runtime = {
      phase: 'running', runId: 'run-active', idempotencyKey: 'message-1', engineType: 'openclaw',
      epoch: 1, sequence: 1, startedAt: 1, lastEventAt: 1,
    };
    useChatRuntimeV2Store.setState({ sessionsByKey: { 'agent:main:main': session } });
    const rpc = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValueOnce({});

    const abortPromise = actions.abortRun();
    await expect(abortPromise).resolves.toBe(true);
    expect(useChatRuntimeV2Store.getState().sessionsByKey['agent:main:main']?.runtime?.runId).toBe('run-active');
    rpc.mockRestore();
  });
});
