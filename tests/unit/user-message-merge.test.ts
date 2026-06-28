import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat/types';
import { WORKFLOW_SESSION_HINT_MARKER } from '@/lib/workflow-session-hint';
import {
  dedupeRedundantUserMessages,
  isSameUserMessage,
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

  it('preserves non-adjacent identical-text user messages as distinct turns', () => {
    // Regression: two separate sends of the same text, separated by an
    // assistant reply, used to be collapsed by the text-based fallback —
    // dropping the second user message and merging the two assistant replies
    // into one turn (the "identical input overwrites previous output" bug).
    const messages = [
      { id: 'user-1', role: 'user', content: 'hello', timestamp: 1710000000 },
      { id: 'assistant-1', role: 'assistant', content: 'reply-1', timestamp: 1710000003 },
      { id: 'user-2', role: 'user', content: 'hello', timestamp: 1710000010 },
      { id: 'assistant-2', role: 'assistant', content: 'reply-2', timestamp: 1710000013 },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, 1710000010000);

    expect(deduped.map((message) => message.content)).toEqual([
      'hello', 'reply-1', 'hello', 'reply-2',
    ]);
  });

  it('drops a non-adjacent user duplicate only when ids match', () => {
    const messages = [
      { id: 'same-id', role: 'user', content: 'hello', timestamp: 1710000000 },
      { id: 'assistant-1', role: 'assistant', content: 'reply', timestamp: 1710000003 },
      { id: 'same-id', role: 'user', content: 'hello', timestamp: 1710000010 },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, null);

    expect(deduped.map((message) => message.content)).toEqual(['hello', 'reply']);
  });

  it('matches optimistic and gateway user when only gateway text has injected hints', () => {
    const optimistic = {
      id: 'local-user-1',
      role: 'user',
      content: '创建工作流测试',
      timestamp: 1710000000,
    } as RawMessage;
    const gatewayUserText = `${WORKFLOW_SESSION_HINT_MARKER}\n## hint\n${WORKFLOW_SESSION_HINT_MARKER}\n创建工作流测试`;
    const enriched = [
      {
        id: 'history-user-1',
        role: 'user',
        content: gatewayUserText,
        timestamp: 1710000030,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '好的',
        timestamp: 1710000031,
      },
    ] as RawMessage[];

    expect(isSameUserMessage(enriched[0], optimistic, 1710000000000)).toBe(true);

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
    });

    expect(merged.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(merged[0]?.id).toBe('history-user-1');
  });

  it('dedupes non-adjacent optimistic echo during active send', () => {
    const messages = [
      { id: 'local-user', role: 'user', content: 'hello', timestamp: 1710000000 },
      { id: 'assistant-1', role: 'assistant', content: 'reply', timestamp: 1710000003 },
      {
        id: 'history-user',
        role: 'user',
        content: `${WORKFLOW_SESSION_HINT_MARKER}\n${WORKFLOW_SESSION_HINT_MARKER}\nhello`,
        timestamp: 1710000040,
      },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, 1710000000000);

    expect(deduped.map((m) => m.id)).toEqual(['assistant-1', 'history-user']);
  });
});
