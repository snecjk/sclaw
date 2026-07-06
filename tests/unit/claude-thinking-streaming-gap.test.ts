import { describe, expect, it } from 'vitest';
import { pickTimelineSourceMessages } from '@/pages/Chat/chat-display';
import { mergeSegmentsMonotonic } from '@/pages/Chat/thinking/segment-merge';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';

const interrupt = '正在拉取工作流参数表单。';

function labels(segments: ReturnType<typeof parseThinkingTurnLayout>['segments']) {
  return segments.map((s) => {
    if (s.kind === 'phase-text') return `P:${s.text.slice(0, 16)}`;
    const t = s.timeline.filter((i) => i.type === 'tool').length;
    const th = s.timeline.filter((i) => i.type === 'thinking').length;
    return `G:think${th}/tool${t}`;
  });
}

function extractText(message: { content?: unknown }): string {
  const c = message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .filter(
      (b): b is { type: string; text?: string } =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text',
    )
    .map((b) => b.text ?? '')
    .join('');
}

describe('Claude workflow sticky cache + streamingTools', () => {
  const thinkingSnaps = [
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '找模板' },
        { type: 'thinking', thinking: '确认 schema' },
      ],
    },
  ];

  const streamingTools = [
    {
      toolCallId: 'toolu_wf1',
      name: 'search_workflow_templates',
      status: 'completed' as const,
      input: { query: '客户异常监控' },
    },
  ];

  const workflowMessages = [
    ...thinkingSnaps,
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '找模板' },
        { type: 'thinking', thinking: '确认 schema' },
        { type: 'tool_use', id: 't1', name: 'search', input: {} },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: interrupt }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'search', input: {} },
        { type: 'tool_use', id: 't2', name: 'get_workflow_schema', input: {} },
      ],
    },
  ];

  it('live + streamingTools: interrupt stays between tool-group summaries', () => {
    const withText = [
      ...thinkingSnaps,
      { role: 'assistant', content: [{ type: 'text', text: interrupt }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_wf1', name: 'search_workflow_templates', input: {} },
          { type: 'tool_use', id: 'toolu_wf2', name: 'get_workflow_schema', input: {} },
        ],
      },
    ];

    const picked = pickTimelineSourceMessages(withText as never);
    expect(picked.some((m) => extractText(m).includes('正在拉取'))).toBe(true);

    const live = parseThinkingTurnLayout(withText as never, {
      isLiveStream: true,
      engineProfile: 'claude',
      streamingTools,
    });

    const between = live.segments.find(
      (s, i) =>
        s.kind === 'phase-text'
        && live.segments[i - 1]?.kind === 'tool-group'
        && live.segments[i + 1]?.kind === 'tool-group',
    );
    expect(between, JSON.stringify(live.segments, null, 2)).toMatchObject({ text: interrupt });
  });

  it('mergeSegmentsMonotonic: incremental snapshots keep phase between groups', () => {
    for (const end of [2, 3, 4]) {
      const cached = parseThinkingTurnLayout(workflowMessages.slice(0, end) as never, {
        isLiveStream: true,
        engineProfile: 'claude',
      }).segments;
      const incoming = parseThinkingTurnLayout(workflowMessages as never, {
        isLiveStream: true,
        engineProfile: 'claude',
      }).segments;
      const merged = mergeSegmentsMonotonic(cached, incoming);
      const between = merged.find(
        (s, i) =>
          s.kind === 'phase-text'
          && merged[i - 1]?.kind === 'tool-group'
          && merged[i + 1]?.kind === 'tool-group',
      );
      expect(
        between,
        `end=${end} cached=${JSON.stringify(labels(cached))} merged=${JSON.stringify(labels(merged))}`,
      ).toMatchObject({ text: interrupt });
    }
  });

  it('done-claude with chronological id fallback: interrupt between adjacent summaries', () => {
    const messages = workflowMessages.map((message, index) => ({
      ...message,
      id: `msg-${index}`,
    }));
    const picked = pickTimelineSourceMessages(messages as never);
    const chronologicalEntries = messages.map((message) => ({
      kind: 'assistant' as const,
      message: { ...message, content: [...(message.content as unknown[])] },
    }));

    const layout = parseThinkingTurnLayout(picked as never, {
      isLiveStream: false,
      engineProfile: 'claude',
      chronologicalEntries,
    });

    const between = layout.segments.find(
      (s, i) =>
        s.kind === 'phase-text'
        && layout.segments[i - 1]?.kind === 'tool-group'
        && layout.segments[i + 1]?.kind === 'tool-group',
    );
    expect(between, JSON.stringify(layout.segments, null, 2)).toMatchObject({
      kind: 'phase-text',
      text: interrupt,
    });
  });
});
