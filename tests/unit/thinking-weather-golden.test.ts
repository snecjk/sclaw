import { describe, expect, it } from 'vitest';
import {
  OPENING_PHASE_TEXT_KEY,
  parseThinkingTurnLayout,
  type ThinkingTurnSegment,
} from '@/pages/Chat/thinking-turn-segments';

const OPENING = '我来为你查询上海未来7天的天气预报。';
const MID_PHASE = '脚本本身已经有 SSL 证书失败的重试降级逻辑，让我换 MCP 工具。';
const FINAL_REPLY =
  '根据检索到的天气预报数据，为你整理上海未来7天天气预报如下：\n\n| 日期 | 天气 | 温度 |\n| --- | --- | --- |';

function segmentOutline(segments: ThinkingTurnSegment[]): string[] {
  return segments.map((segment) => {
    if (segment.kind === 'phase-text') {
      return `phase:${segment.text.slice(0, 10)}`;
    }
    const toolCount = segment.timeline.filter((item) => item.type === 'tool').length;
    const thoughtCount = segment.timeline.filter((item) => item.type === 'thinking').length;
    return `group:${segment.state}:${thoughtCount}t/${toolCount}tools`;
  });
}

/** 图一：开场 + 首批 live 工具，尚无一级摘要 */
const FIG1_LIVE_MESSAGES = [
  {
    role: 'assistant',
    content: [
      { type: 'text', text: OPENING },
      { type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'query.py' } },
      { type: 'tool_use', id: 't2', name: 'glob', input: { pattern: '**/query.py' } },
      { type: 'tool_use', id: 't3', name: 'exec', input: { cmd: 'python3 query.py' } },
    ],
  },
];

/** 图二：上一批收成摘要 + 阶段短 text + 新 live 批 */
const FIG2_LIVE_MESSAGES = [
  {
    role: 'assistant',
    content: [
      { type: 'text', text: OPENING },
      { type: 'tool_use', id: 't1', name: 'exec', input: { n: 1 } },
      { type: 'tool_use', id: 't2', name: 'exec', input: { n: 2 } },
      { type: 'text', text: MID_PHASE },
      { type: 'tool_use', id: 't3', name: 'web_search', input: { q: '上海天气' } },
    ],
  },
];

/** 图三：完成态 text ↔ 摘要交替 + 最终正文 */
const FIG3_DONE_MESSAGES = [
  {
    role: 'assistant',
    content: [
      { type: 'text', text: OPENING },
      { type: 'tool_use', id: 't1', name: 'exec', input: {} },
      { type: 'tool_use', id: 't2', name: 'exec', input: {} },
      { type: 'text', text: MID_PHASE },
      { type: 'text', text: '让我用 MCP 工具来获取更准确的预报。' },
      { type: 'tool_use', id: 't3', name: 'mcp_weather', input: {} },
      { type: 'text', text: FINAL_REPLY },
    ],
  },
];

describe('weather golden fixtures (四图)', () => {
  it('图一 live：开场 phase-text + 单一 active tool-group，无 completed 摘要', () => {
    const layout = parseThinkingTurnLayout(FIG1_LIVE_MESSAGES, { isLiveStream: true });

    expect(layout.finalReplyText).toBeNull();
    expect(segmentOutline(layout.segments)).toEqual([
      'phase:我来为你查询上海未来',
      'group:active:0t/3tools',
    ]);

    const opening = layout.segments[0];
    expect(opening?.kind).toBe('phase-text');
    if (opening?.kind === 'phase-text') {
      expect(opening.key).toBe(OPENING_PHASE_TEXT_KEY);
    }

    const groups = layout.segments.filter((s) => s.kind === 'tool-group');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind === 'tool-group' && groups[0].state).toBe('active');
    expect(groups.every((g) => g.kind !== 'tool-group' || g.state !== 'completed')).toBe(true);
  });

  it('图二 live：开场保留 + completed 摘要 + 独立 phase-text + active 新批', () => {
    const layout = parseThinkingTurnLayout(FIG2_LIVE_MESSAGES, { isLiveStream: true });

    expect(layout.finalReplyText).toBeNull();
    expect(segmentOutline(layout.segments)).toEqual([
      'phase:我来为你查询上海未来',
      'group:completed:0t/2tools',
      `phase:${MID_PHASE.slice(0, 10)}`,
      'group:active:0t/1tools',
    ]);

    const completed = layout.segments.filter(
      (s): s is Extract<typeof s, { kind: 'tool-group' }> =>
        s.kind === 'tool-group' && s.state === 'completed',
    );
    const active = layout.segments.filter(
      (s): s is Extract<typeof s, { kind: 'tool-group' }> =>
        s.kind === 'tool-group' && s.state === 'active',
    );
    expect(completed).toHaveLength(1);
    expect(active).toHaveLength(1);

    const midIdx = layout.segments.findIndex((s) => s.kind === 'phase-text' && s.text === MID_PHASE);
    const completedIdx = layout.segments.findIndex(
      (s) => s.kind === 'tool-group' && s.state === 'completed',
    );
    const activeIdx = layout.segments.findIndex(
      (s) => s.kind === 'tool-group' && s.state === 'active',
    );
    expect(completedIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(activeIdx);
  });

  it('图三 done：text ↔ 摘要交替，全部 completed，最终正文分离', () => {
    const layout = parseThinkingTurnLayout(FIG3_DONE_MESSAGES, { isLiveStream: false });

    expect(layout.finalReplyText).toContain('根据检索到的天气预报数据');
    expect(layout.segments.every((s) => s.kind !== 'tool-group' || s.state === 'completed')).toBe(
      true,
    );
    expect(layout.segments.filter((s) => s.kind === 'phase-text').length).toBeGreaterThanOrEqual(2);
    expect(
      layout.segments.some((s) => s.kind === 'phase-text' && s.text.includes('SSL 证书')),
    ).toBe(true);
    expect(
      layout.segments.some((s) => s.kind === 'phase-text' && s.text.includes('MCP 工具')),
    ).toBe(true);
    expect(
      layout.segments.every(
        (s) => s.kind !== 'phase-text' || !s.text.includes('| 日期 |'),
      ),
    ).toBe(true);
  });

  it('图四 done：与图三相同 segment 结构（展开为纯 UI 态）', () => {
    const fig3 = parseThinkingTurnLayout(FIG3_DONE_MESSAGES, { isLiveStream: false });
    const fig4 = parseThinkingTurnLayout(FIG3_DONE_MESSAGES, { isLiveStream: false });

    expect(segmentOutline(fig4.segments)).toEqual(segmentOutline(fig3.segments));
    expect(fig4.finalReplyText).toBe(fig3.finalReplyText);
  });

  it('上海天气 done：堆叠旁白拆成图二 text ↔ 一级摘要交替（蓝框批次收起）', () => {
    const narrations = [
      '我来帮你查询上海未来 7 天的天气预报。',
      '我获取到了上海的天气预报数据。让我再获取更详细的 7 天预报：',
      '让我用更好的格式获取完整的 7 天预报：',
      '目前只能获取到 3 天的详细预报。让我再获取更完整的 7 天数据：',
      'wttr.in 免费版只提供 3 天预报。让我用其他来源获取 7 天预报：',
      '现在我来补充天气代码 96 和 99 的含义，并整理成更清晰的表格：',
    ];
    const thinkings = Array.from({ length: 12 }, (_, index) => ({
      type: 'thinking' as const,
      thinking: `规划步骤 ${index + 1}：继续拉取上海 7 天预报`,
    }));
    const messages = [
      ...narrations.map((text) => ({
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text }],
      })),
      {
        role: 'assistant' as const,
        content: thinkings,
      },
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: FINAL_REPLY }],
      },
    ];

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });

    expect(done.finalReplyText).toContain('根据检索到的天气预报数据');
    expect(done.segments.map((segment) => segment.kind)).toMatchInlineSnapshot(`
      [
        "phase-text",
        "tool-group",
        "phase-text",
        "tool-group",
        "phase-text",
        "tool-group",
        "phase-text",
        "tool-group",
        "phase-text",
        "tool-group",
        "phase-text",
        "tool-group",
      ]
    `);
    expect(done.segments.filter((segment) => segment.kind === 'phase-text')).toHaveLength(6);
    expect(done.segments.filter((segment) => segment.kind === 'tool-group')).toHaveLength(6);
    expect(done.segments.map((segment) => segment.kind)).toEqual([
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
    ]);

    const groups = done.segments.filter(
      (segment): segment is Extract<typeof segment, { kind: 'tool-group' }> =>
        segment.kind === 'tool-group',
    );
    const totalThoughts = groups.reduce(
      (count, group) => count + group.timeline.filter((item) => item.type === 'thinking').length,
      0,
    );
    expect(totalThoughts).toBeGreaterThanOrEqual(12);
    expect(
      groups.every((group) => group.timeline.filter((item) => item.type === 'thinking').length >= 1),
    ).toBe(true);
    expect(done.segments[0]?.kind === 'phase-text' && done.segments[0].text).toContain(
      '我来帮你查询上海',
    );
  });
});
