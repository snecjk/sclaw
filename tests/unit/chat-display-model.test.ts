import { describe, expect, it } from 'vitest';
import { buildChatDisplayModel, materializeCompletedOverlay } from '@/stores/chat/display-model';
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

  it('does not materialize live preparation progress into completed chat display', () => {
    const transcript = [{ id: 'user-1', role: 'user' as const, content: '你好' }];
    const overlay = {
      ...createClientSessionState().overlay,
      streamingMessages: [{
        id: 'agent-preparation-memory-message-1',
        role: 'assistant' as const,
        content: '已检索到相关记忆',
        metadata: { kind: 'agent-preparation-progress', stage: 'memory', status: 'completed' },
      }],
      streamingMessage: { id: 'assistant-1', role: 'assistant' as const, content: '你好' },
    };

    expect(materializeCompletedOverlay(transcript, overlay).map((message) => message.id))
      .toEqual(['user-1', 'assistant-1']);
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

  it('keeps workflow composer segments when pairing an empty-content optimistic turn', () => {
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: {
        id: 'optimistic-wf',
        role: 'user' as const,
        content: '',
        _composerSegments: [{ type: 'workflow' as const, id: 'wf-1', name: '日报', source: 'mine' }],
      },
    };

    const displayed = buildChatDisplayModel([], overlay);

    expect(displayed).toHaveLength(1);
    expect(displayed[0]?._composerSegments?.[0]).toMatchObject({ type: 'workflow', name: '日报' });
  });

  it('materializes a completed overlay in chronological display order', () => {
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: {
        id: 'user-1', role: 'user' as const, content: '你是谁', timestamp: 1,
      },
      streamingMessages: [
        { id: 'assistant-thinking', role: 'assistant' as const, content: '思考', timestamp: 2 },
      ],
      streamingToolResults: [
        { id: 'tool-1', role: 'toolresult' as const, content: '工具结果', timestamp: 3 },
      ],
      streamingMessage: {
        id: 'assistant-final', role: 'assistant' as const, content: '我是最终回复', timestamp: 4,
      },
      awaitingTranscript: true,
    };

    expect(materializeCompletedOverlay([], overlay).map((message) => message.id)).toEqual([
      'user-1',
      'assistant-thinking',
      'tool-1',
      'assistant-final',
    ]);
  });
});
