import { describe, expect, it } from 'vitest';
import { buildChatDisplayModel } from '@/stores/chat/display-model';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';

describe('chat display model', () => {
  it('projects optimistic and streaming overlays without mutating transcript', () => {
    const transcript = [{ id: 'history-1', role: 'user' as const, content: 'hello' }];
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: { id: 'local-1', role: 'user' as const, content: 'next' },
      streamingMessage: { id: 'stream-1', role: 'assistant' as const, content: 'working' },
    };
    expect(buildChatDisplayModel(transcript, overlay).map((message) => message.id))
      .toEqual(['history-1', 'local-1', 'stream-1']);
    expect(transcript).toHaveLength(1);
  });

  it('does not duplicate an optimistic message after the transcript echoes its id', () => {
    const echoed = { id: 'local-1', role: 'user' as const, content: 'hello' };
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: echoed,
    };
    expect(buildChatDisplayModel([echoed], overlay)).toEqual([echoed]);
  });

  it('drops a synthetic session-label opener while the optimistic skill turn is visible', () => {
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: {
        id: 'optimistic-1',
        role: 'user' as const,
        content: '帮我做报价测算：覆盖新客测算与老客调价，并给出调价建议。',
        _skillMeta: { slug: 'customer-monitor', title: '客户异常监控' },
      },
    };
    const projected = [
      {
        id: 'session-label-user-agent:main:session-1',
        role: 'user' as const,
        content: '帮我做报价测算：覆盖新客测算与老客调价',
      },
    ];

    const displayed = buildChatDisplayModel([], overlay, { projectedMessages: projected });

    expect(displayed).toHaveLength(1);
    expect(displayed[0]?.id).toBe('optimistic-1');
    expect(displayed[0]?._skillMeta?.title).toBe('客户异常监控');
  });

  it('merges a plain history echo into the optimistic skill chip instead of showing two bubbles', () => {
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: {
        id: 'optimistic-1',
        role: 'user' as const,
        content: '帮我做报价测算',
        _skillMeta: { slug: 'customer-monitor', title: '客户异常监控' },
      },
    };
    const history = [
      { id: 'history-1', role: 'user' as const, content: '帮我做报价测算' },
    ];

    const displayed = buildChatDisplayModel(history, overlay);

    expect(displayed).toHaveLength(1);
    expect(displayed[0]?.id).toBe('history-1');
    expect(displayed[0]?._skillMeta?.title).toBe('客户异常监控');
  });
});
