import { describe, expect, it } from 'vitest';
import type { ChatDisplayItem } from '@/pages/Chat/chat-display';
import {
  CHAT_VIRTUAL_LIST_THRESHOLD,
  estimateChatDisplayItemSize,
} from '@/pages/Chat/chat-display-item-size';

describe('chat display item virtualization', () => {
  it('estimates larger rows for assistant turns with more messages', () => {
    const smallTurn: ChatDisplayItem = {
      type: 'assistant-turn',
      key: 'turn-a',
      messages: [{ role: 'assistant', content: 'hi' }],
      toolResults: [],
    };
    const largeTurn: ChatDisplayItem = {
      type: 'assistant-turn',
      key: 'turn-b',
      messages: Array.from({ length: 8 }, (_, index) => ({
        role: 'assistant' as const,
        content: `chunk-${index}`,
      })),
      toolResults: [{ role: 'toolresult', content: 'ok' }],
    };

    expect(estimateChatDisplayItemSize(largeTurn)).toBeGreaterThan(
      estimateChatDisplayItemSize(smallTurn),
    );
  });

  it('uses a threshold so short sessions skip virtualization', () => {
    expect(CHAT_VIRTUAL_LIST_THRESHOLD).toBeGreaterThan(10);
  });
});
