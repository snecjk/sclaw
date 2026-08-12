import { describe, expect, it } from 'vitest';
import { insertOptimisticUserTurn } from '@/stores/chat/optimistic-turn';
import { initialChatDataState } from '@/stores/chat/initial-state';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import type { ChatState } from '@/stores/chat/types';
import type { ChatSet } from '@/stores/chat/store-api';

describe('optimistic user turns', () => {
  it('records a background send in its runtime without changing visible messages', () => {
    const visibleMessage = { role: 'assistant' as const, content: 'visible', id: 'visible-1' };
    let state = {
      ...initialChatDataState,
      currentSessionKey: 'agent:main:visible',
      currentAgentId: 'main',
      sessionLabels: {},
    } as unknown as ChatState;
    useChatRuntimeV2Store.getState().clearSession('agent:main:visible');
    useChatRuntimeV2Store.getState().clearSession('agent:writer:queued');
    useChatRuntimeV2Store.getState().setTranscript('agent:main:visible', [visibleMessage]);
    const get = () => state;
    const set: ChatSet = (partial) => {
      state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
    };

    const result = insertOptimisticUserTurn({
      get,
      set,
      sessionKey: 'agent:writer:queued',
      displayText: 'queued text',
      gatewayMessage: 'queued text',
    });

    expect(useChatRuntimeV2Store.getState().sessionsByKey['agent:main:visible']?.transcript)
      .toEqual([visibleMessage]);
    expect(useChatRuntimeV2Store.getState().sessionsByKey['agent:writer:queued']?.overlay.optimisticUserMessage)
      .toEqual(result);
  });
});
