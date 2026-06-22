import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat/types';
import {
  dedupeRedundantUserMessages,
  mergeOptimisticUserIntoHistory,
} from '@/stores/chat/user-message-merge';

describe('user-message-merge', () => {
  it('does not append optimistic user when history already has matching text', () => {
    const optimistic = {
      id: 'local-user-1',
      role: 'user',
      content: '你仔细看下',
      timestamp: 1710000000,
    } as RawMessage;
    const enriched = [
      {
        id: 'history-user-1',
        role: 'user',
        content: '你仔细看下',
        timestamp: 1700000000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '连接模型中...',
        timestamp: 1710000001,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
    });

    expect(merged.map((message) => message.content)).toEqual([
      '你仔细看下',
      '连接模型中...',
    ]);
  });

  it('inserts optimistic user before assistant when history has not caught up', () => {
    const optimistic = {
      id: 'local-user-1',
      role: 'user',
      content: '你仔细看下',
      timestamp: 1710000000,
    } as RawMessage;
    const enriched = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '连接模型中...',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
    });

    expect(merged.map((message) => message.content)).toEqual([
      '你仔细看下',
      '连接模型中...',
    ]);
  });

  it('removes consecutive duplicate user messages', () => {
    const messages = [
      { id: 'user-1', role: 'user', content: '你仔细看下', timestamp: 1710000000 },
      { id: 'user-2', role: 'user', content: '你仔细看下', timestamp: 1710000000 },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, 1710000000000);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.content).toBe('你仔细看下');
  });
});
