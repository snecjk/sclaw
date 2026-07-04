import { describe, expect, it } from 'vitest';
import { mergeSegmentsMonotonic } from '@/pages/Chat/thinking/segment-merge';
import {
  buildThinkingGroupSummaryLabel,
  parseThinkingTurnLayout,
} from '@/pages/Chat/thinking-turn-segments';

const intro =
  '已为您加载「客户异常监控」工作流配置表单，请在下方分步确认：\n\n'
  + '**数据来源**：选择发件基础信息和/或服务质量信息';
const interrupt = '正在拉取工作流参数表单。';

function summarize(layout: ReturnType<typeof parseThinkingTurnLayout>) {
  const t = (key: string, opts?: Record<string, unknown>) => {
    if (key === 'streaming.collapsedSummaryThoughtsOnly') return `思考${opts?.thoughtCount}`;
    if (key === 'streaming.collapsedSummaryToolsOnly') return `工具${opts?.toolCount}`;
    return key;
  };
  return layout.segments
    .map((s) => {
      if (s.kind === 'phase-text') return `P:${s.text.slice(0, 12)}`;
      return `G:${buildThinkingGroupSummaryLabel(s.timeline, t)}`;
    })
    .join(' | ');
}

describe('Claude workflow done repro (screenshot)', () => {
  const streamingTools = [
    {
      toolCallId: 'toolu_search',
      name: 'search_workflow_templates',
      status: 'completed' as const,
      input: { query: '客户异常监控' },
    },
  ];

  it('A: thinking history + long intro only → single combined summary (no empty gap)', () => {
    const layout = parseThinkingTurnLayout(
      [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '搜索客户异常监控模板' },
            { type: 'thinking', thinking: '确认工作流 schema' },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: intro }] },
      ] as never,
      { isLiveStream: false, engineProfile: 'claude', streamingTools },
    );
    const groups = layout.segments.filter((s) => s.kind === 'tool-group');
    expect(groups).toHaveLength(1);
    if (groups[0]?.kind !== 'tool-group') return;
    expect(groups[0].timeline.filter((i) => i.type === 'thinking')).toHaveLength(2);
    expect(groups[0].timeline.filter((i) => i.type === 'tool')).toHaveLength(1);
  });

  it('B: separate interrupt snapshot + long intro', () => {
    const layout = parseThinkingTurnLayout(
      [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '搜索客户异常监控模板' },
            { type: 'thinking', thinking: '确认工作流 schema' },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: interrupt }] },
        { role: 'assistant', content: [{ type: 'text', text: intro }] },
      ] as never,
      { isLiveStream: false, engineProfile: 'claude', streamingTools },
    );
    expect(summarize(layout)).toContain('P:正在拉取工作流');
  });

  it('C: interrupt in thinking snapshot (tool stripped from history)', () => {
    const layout = parseThinkingTurnLayout(
      [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '搜索客户异常监控模板' },
            { type: 'thinking', thinking: '确认工作流 schema' },
            { type: 'text', text: interrupt },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: intro }] },
      ] as never,
      { isLiveStream: false, engineProfile: 'claude', streamingTools },
    );
    const between = layout.segments.find(
      (s, i) =>
        s.kind === 'phase-text'
        && layout.segments[i - 1]?.kind === 'tool-group'
        && layout.segments[i + 1]?.kind === 'tool-group',
    );
    expect(summarize(layout)).toContain('P:');
    expect(between).toMatchObject({ text: interrupt });
  });

  it('sticky cache: live two-group cache + done single-group incoming merges cleanly', () => {
    const cached = [
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-0',
        timeline: [
          { type: 'thinking' as const, content: 'a' },
          { type: 'thinking' as const, content: 'b' },
        ],
        state: 'completed' as const,
      },
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-1',
        timeline: [
          {
            type: 'tool' as const,
            index: 1,
            id: 't1',
            name: 'search_workflow_templates',
            input: {},
          },
        ],
        state: 'completed' as const,
      },
    ];
    const incoming = parseThinkingTurnLayout(
      [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'a' },
            { type: 'thinking', thinking: 'b' },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: intro }] },
      ] as never,
      { isLiveStream: false, engineProfile: 'claude', streamingTools },
    ).segments;

    const merged = mergeSegmentsMonotonic(cached, incoming);
    const groups = merged.filter((s) => s.kind === 'tool-group');
    expect(groups).toHaveLength(1);
  });
});
