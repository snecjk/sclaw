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
      messages: [visibleMessage],
      sessionLabels: {},
    } as unknown as ChatState;
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

    expect(state.messages).toEqual([visibleMessage]);
    expect(useChatRuntimeV2Store.getState().sessionsByKey['agent:writer:queued']?.overlay.optimisticUserMessage)
      .toEqual(result);
  });
});
