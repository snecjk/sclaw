import { describe, expect, it } from 'vitest';
import {
  buildChatDisplayItems,
  buildTurnStableKey,
  isRedundantThinking,
  mergeWorkflowCardsIntoDisplayItems,
  mergeThinkingTimelines,
  pickTimelineSourceMessages,
  resolveActiveTurnStableKey,
  shouldReplaceStreamSnapshot,
} from '../../src/pages/Chat/chat-display';
import { parseThinkingTurnLayout } from '../../src/pages/Chat/thinking-turn-segments';

describe('mergeThinkingTimelines', () => {
  it('folds streaming thinking-only snapshots to the latest one', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '用户要求发送明天上海的天气给文鹏，我需要先调用天气技能获取数据。' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '用户要求发送明天上海的天气，我需要先调用天气技能获取数据，然后使用钉钉格式发送给文鹏。' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: '用户要求发送明天上海的天气，我需要先调用天气技能获取数据，然后使用钉钉格式发送给文鹏。',
          },
          { type: 'tool_use', id: 'tool-1', name: 'web_fetch', input: { url: 'https://wttr.in' } },
        ],
      },
    ];

    const timeline = mergeThinkingTimelines(messages);
    const thinking = timeline.filter((item) => item.type === 'thinking');
    expect(thinking).toHaveLength(1);
    expect(thinking[0]?.type === 'thinking' && thinking[0].content).toContain('钉钉格式');
    expect(timeline.filter((item) => item.type === 'tool')).toHaveLength(1);
  });

  it('includes OpenAI tool_calls on the message when content already has thinking', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '数据全部拿到了，我来生成报表。' },
          { type: 'text', text: '数据全部拿到了，我来生成报表...' },
        ],
        tool_calls: [
          {
            id: 'call_write_1',
            type: 'function',
            function: { name: 'write', arguments: '{"path":"report.md"}' },
          },
        ],
      },
    ];

    const timeline = mergeThinkingTimelines(messages);
    expect(timeline.filter((item) => item.type === 'tool')).toHaveLength(1);
    expect(timeline.find((item) => item.type === 'tool')?.name).toBe('write');
  });

  it('keeps distinct thinking before and after a tool call', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先调用天气接口。' },
          { type: 'tool_use', id: 'tool-1', name: 'web_fetch', input: {} },
          { type: 'thinking', thinking: 'wttr.in 返回模板变量，需要换数据源。' },
        ],
      },
    ];

    const timeline = mergeThinkingTimelines(messages);
    expect(timeline.filter((item) => item.type === 'thinking')).toHaveLength(2);
  });

  it('folds Claude streaming snapshots that only refresh thinking on known tools', () => {
    const planning = '用户要周报PPT，我先读取模板目录确认可用文件。';
    const rephrase = `${planning}再检查 skills 目录。`;
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: planning },
          { type: 'tool_use', id: 'toolu_read', name: 'read', input: { path: '/tmp' } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: rephrase },
          { type: 'tool_use', id: 'toolu_read', name: 'read', input: { path: '/tmp' } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '模板已确认，开始写入周报骨架。' },
          { type: 'tool_use', id: 'toolu_write', name: 'write', input: { path: '/out.pptx' } },
        ],
      },
    ];

    expect(pickTimelineSourceMessages(messages)).toHaveLength(2);

    const timeline = mergeThinkingTimelines(messages);
    expect(timeline.filter((item) => item.type === 'thinking')).toHaveLength(2);
    expect(timeline.filter((item) => item.type === 'tool')).toHaveLength(2);
  });

  it('does not grow thought count on repeated Claude snapshots in one tool round', () => {
    const base = '了解，我直接为您生成一个专业美观的周报PPT模板。';
    const snapshots = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: base },
          { type: 'thinking', thinking: '先读取工作区文件。' },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: base },
          {
            type: 'thinking',
            thinking: '先读取工作区文件，确认是否有周报模板或技能目录。',
          },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: base },
          {
            type: 'thinking',
            thinking: '先读取工作区文件，确认是否有周报模板或技能目录，再决定生成方式。',
          },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
        ],
      },
    ];

    const counts = snapshots.map((_, end) => {
      const layout = parseThinkingTurnLayout(snapshots.slice(0, end + 1), { isLiveStream: true });
      const group = layout.segments.find((segment) => segment.kind === 'tool-group');
      if (group?.kind !== 'tool-group') return 0;
      return group.timeline.filter((item) => item.type === 'thinking').length;
    });

    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(1);
    expect(counts[2]).toBe(1);
  });

  it('folds Claude snapshots with same tool set even when phase text changes', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来帮你生成周报PPT。' },
          { type: 'thinking', thinking: '先读取工作区文件。' },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '让我先检查 skills 目录里有没有模板。' },
          { type: 'thinking', thinking: '先读取工作区文件，确认模板路径。' },
          { type: 'thinking', thinking: '若没有模板就手动创建骨架。' },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
        ],
      },
    ];

    expect(pickTimelineSourceMessages(messages)).toHaveLength(1);

    const layout = parseThinkingTurnLayout(messages, { isLiveStream: true });
    const group = layout.segments.find((segment) => segment.kind === 'tool-group');
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;
    expect(group.timeline.filter((item) => item.type === 'thinking').length).toBeLessThanOrEqual(2);
    expect(group.timeline.filter((item) => item.type === 'tool')).toHaveLength(1);
  });

  it('keeps narration text when a later thinking-only snapshot arrives', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我来帮你分析数据。' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先查 dws。' },
          { type: 'tool_use', id: 't1', name: 'dws', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '我需要先获取近半年的单量数据。让我使用 dws 工具来查询相关数据。',
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '确认字段后继续。' }],
      },
    ];

    const picked = pickTimelineSourceMessages(messages);
    expect(picked).toHaveLength(4);
    const narration = picked[2] as { content?: Array<{ text?: string }> };
    expect(narration.content?.[0]?.text?.slice(0, 6)).toBe('我需要先获取');
  });

  it('replaces narration-only stream snapshot when the same buffer grows tools', () => {
    const committed = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来帮你分析数据。' },
          { type: 'thinking', thinking: '先查 dws。' },
          { type: 'tool_use', id: 't1', name: 'dws', input: {} },
        ],
      },
    ];
    const narrationStream = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '我需要先获取近半年的单量数据。让我使用 dws 工具来查询相关数据。',
        },
      ],
    };
    const toolStream = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '先查 dws，确认字段。' },
        { type: 'tool_use', id: 't1', name: 'dws', input: {} },
      ],
    };

    expect(shouldReplaceStreamSnapshot(narrationStream, toolStream)).toBe(true);

    const layout = parseThinkingTurnLayout([...committed, toolStream], { isLiveStream: true });
    const groups = layout.segments.filter((segment) => segment.kind === 'tool-group');
    expect(groups).toHaveLength(1);
    if (groups[0]?.kind !== 'tool-group') return;
    expect(groups[0].timeline.filter((item) => item.type === 'thinking')).toHaveLength(1);
    expect(groups[0].timeline.filter((item) => item.type === 'tool')).toHaveLength(1);
  });
});

describe('buildTurnStableKey', () => {
  it('uses preceding user id so key does not change when final reply is appended', () => {
    const user = { id: 'user-weather-1', role: 'user' as const, content: '查上海天气' };
    const snapshot = {
      id: 'snap-1',
      role: 'assistant' as const,
      content: [
        { type: 'thinking', thinking: '先查天气' },
        { type: 'tool_use', id: 'toolu_abc', name: 'web_search', input: {} },
      ],
    };
    const finalReply = {
      id: 'final-1',
      role: 'assistant' as const,
      content: [{ type: 'text', text: '明天上海晴，18°C。' }],
    };

    const midTurn = buildChatDisplayItems([user, snapshot]);
    const doneTurn = buildChatDisplayItems([user, snapshot, finalReply]);

    expect(midTurn).toHaveLength(2);
    expect(doneTurn).toHaveLength(2);
    if (midTurn[1]?.type !== 'assistant-turn' || doneTurn[1]?.type !== 'assistant-turn') return;

    expect(midTurn[1].key).toBe('turn-user-user-weather-1');
    expect(doneTurn[1].key).toBe(midTurn[1].key);
    expect(resolveActiveTurnStableKey([user, snapshot])).toBe('turn-user-user-weather-1');
    expect(resolveActiveTurnStableKey([user, snapshot, finalReply])).toBe('turn-user-user-weather-1');
    expect(buildTurnStableKey(user, 1)).toBe('turn-user-user-weather-1');
  });
});

describe('isRedundantThinking', () => {
  it('detects minor rewording with same intent prefix', () => {
    const a = '用户要求发送明天上海的天气给文鹏，我需要先调用天气技能获取数据。';
    const b = '用户要求发送明天上海的天气，我需要先调用天气技能获取数据，然后使用钉钉格式发送给文鹏。';
    expect(isRedundantThinking(a, b)).toBe(true);
  });
});

describe('mergeWorkflowCardsIntoDisplayItems', () => {
  it('places an anchored card after the complete assistant turn', () => {
    const items = buildChatDisplayItems([
      { id: 'user-1', role: 'user', content: '启动天气工作流', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: '已启动', timestamp: 2 },
      { id: 'user-2', role: 'user', content: '继续聊天', timestamp: 4 },
      { id: 'assistant-2', role: 'assistant', content: '好的', timestamp: 5 },
    ]);
    const merged = mergeWorkflowCardsIntoDisplayItems(items, [{
      runId: 'run-1',
      sessionKey: 'session-1',
      anchorUserMessageId: 'user-1',
      title: '天气工作流',
      startedAt: '1970-01-01T00:00:03.000Z',
    }]);

    expect(merged.map((item) => item.type === 'workflow-run' ? item.key : item.type)).toEqual([
      'single',
      'single',
      'workflow-run:run-1',
      'single',
      'single',
    ]);
  });

  it('uses startedAt for a missing anchor and deduplicates run ids', () => {
    const items = buildChatDisplayItems([
      { id: 'user-1', role: 'user', content: '第一轮', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: '完成', timestamp: 2 },
      { id: 'user-2', role: 'user', content: '第二轮', timestamp: 4 },
    ]);
    const card = {
      runId: 'run-standalone',
      sessionKey: 'session-1',
      anchorUserMessageId: 'missing-user',
      title: '独立工作流',
      startedAt: '1970-01-01T00:00:03.000Z',
    };
    const merged = mergeWorkflowCardsIntoDisplayItems(items, [card, card]);

    expect(merged.filter((item) => item.type === 'workflow-run')).toHaveLength(1);
    expect(merged.findIndex((item) => item.type === 'workflow-run')).toBe(2);
  });
});
