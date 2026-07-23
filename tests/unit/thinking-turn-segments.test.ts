import { describe, expect, it } from 'vitest';
import { pickTimelineSourceMessages } from '../../src/pages/Chat/chat-display';
import {
  parseThinkingTurnLayout,
  OPENING_PHASE_TEXT_KEY,
  rebalanceThinkingTimelineForDisplay,
} from '../../src/pages/Chat/thinking-turn-segments';
import type { ThinkingTimelineItem } from '../../src/pages/Chat/message-utils';

describe('parseThinkingTurnLayout', () => {
  it('splits phase text and tool groups when short text interrupts thinking', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来为你查询上海未来7天的天气预报。' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'a' } },
          { type: 'tool_use', id: 't2', name: 'exec', input: { cmd: 'b' } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来为你查询上海未来7天的天气预报。' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'a' } },
          { type: 'tool_use', id: 't2', name: 'exec', input: { cmd: 'b' } },
          { type: 'text', text: '脚本本身已经有 SSL 证书失败的重试降级逻辑，让我换 MCP 工具。' },
          { type: 'tool_use', id: 't3', name: 'web_search', input: { q: 'weather' } },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(live.finalReplyText).toBeNull();
    expect(live.segments.filter((s) => s.kind === 'phase-text')).toHaveLength(2);
    expect(live.segments.filter((s) => s.kind === 'tool-group')).toHaveLength(2);
    expect(live.segments[0]).toMatchObject({ kind: 'phase-text' });
    expect(live.segments[1]).toMatchObject({ kind: 'tool-group', state: 'completed' });
    expect(live.segments[2]).toMatchObject({ kind: 'phase-text' });
    expect(live.segments[3]).toMatchObject({ kind: 'tool-group', state: 'active' });

    const done = parseThinkingTurnLayout(
      [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '我来为你查询上海未来7天的天气预报。' },
            { type: 'tool_use', id: 't1', name: 'exec', input: {} },
            { type: 'tool_use', id: 't2', name: 'exec', input: {} },
            { type: 'text', text: '脚本本身已经有 SSL 证书失败的重试降级逻辑。' },
            { type: 'tool_use', id: 't3', name: 'web_search', input: {} },
            { type: 'text', text: '根据检索到的数据，上海未来7天天气预报如下：\n\n| 日期 | 天气 |' },
          ],
        },
      ],
      { isLiveStream: false },
    );

    expect(done.finalReplyText).toContain('根据检索到的数据');
    expect(done.segments.filter((s) => s.kind === 'phase-text')).toHaveLength(2);
    expect(done.segments.filter((s) => s.kind === 'tool-group')).toHaveLength(2);
    expect(done.segments.every((s) => s.kind !== 'tool-group' || s.state === 'completed')).toBe(true);
  });

  it('does not collapse thinking-only groups before tools (Claude-style narration)', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来先获取上海最近 7 天的天气数据。' },
          { type: 'thinking', thinking: '需要先拉 wttr.in 数据' },
          { type: 'text', text: '我需要获取更详细的 7 天数据。' },
          { type: 'thinking', thinking: '换 MCP 工具试试' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'a' } },
          { type: 'tool_use', id: 't2', name: 'exec', input: { cmd: 'b' } },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(live.segments.filter((s) => s.kind === 'phase-text')).toHaveLength(2);
    expect(live.segments[0]).toMatchObject({ kind: 'phase-text' });
    expect(live.segments[1]).toMatchObject({ kind: 'tool-group', state: 'completed' });
    expect(live.segments[2]).toMatchObject({ kind: 'phase-text' });
    expect(live.segments[3]).toMatchObject({ kind: 'tool-group', state: 'active' });

    const active = live.segments.find(
      (s): s is Extract<typeof s, { kind: 'tool-group' }> =>
        s.kind === 'tool-group' && s.state === 'active',
    );
    expect(active?.timeline.filter((t) => t.type === 'tool')).toHaveLength(1);
    expect(
      live.segments.find(
        (s): s is Extract<typeof s, { kind: 'tool-group' }> =>
          s.kind === 'tool-group' && s.state === 'completed',
      )?.timeline.filter((t) => t.type === 'thinking').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('interleaves Claude text-only messages before a batched tool message', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我来帮您生成 PPT，先获取天气数据。' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '数据不够，换 deep-research。' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '再联网搜索补充。' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '准备调用工具' },
          { type: 'tool_use', id: 't1', name: 'read', input: {} },
          { type: 'tool_use', id: 't2', name: 'exec', input: {} },
          { type: 'tool_use', id: 't3', name: 'web_search', input: {} },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true, engineProfile: 'claude' });
    const firstGroupIndex = live.segments.findIndex((segment) => segment.kind === 'tool-group');
    const preGroupPhaseTexts = live.segments
      .slice(0, firstGroupIndex)
      .filter((segment) => segment.kind === 'phase-text');

    // Claude 图二：opening 与 pre-batch 旁白都在首个摘要之下
    expect(preGroupPhaseTexts).toHaveLength(0);

    expect(live.segments.map((segment) => segment.kind)).toEqual([
      'tool-group',
      'phase-text',
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
    ]);

    const groups = live.segments.filter(
      (segment): segment is Extract<typeof segment, { kind: 'tool-group' }> =>
        segment.kind === 'tool-group',
    );
    expect(groups).toHaveLength(3);
    expect(
      groups.every((group) => group.timeline.filter((item) => item.type === 'tool').length === 1),
    ).toBe(true);
    expect(groups[groups.length - 1]?.state).toBe('active');
  });

  it('preserves tools when the last snapshot is text-only', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先查数据' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { n: 1 } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '再查一次' },
          { type: 'tool_use', id: 't2', name: 'exec', input: { n: 2 } },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '## 总结\n\n分析完成。' }],
      },
    ];

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    const group = done.segments.find((s) => s.kind === 'tool-group');
    expect(group?.kind === 'tool-group' && group.timeline.filter((t) => t.type === 'tool')).toHaveLength(2);
    expect(
      group?.kind === 'tool-group'
        && group.timeline.filter((t) => t.type === 'thinking').length,
    ).toBeGreaterThanOrEqual(1);
    expect(done.finalReplyText).toContain('分析完成');
  });

  it('interleaves bundled Claude thinking blocks before tool blocks', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '思考 1' },
          { type: 'thinking', thinking: '思考 2' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { n: 1 } },
          { type: 'tool_use', id: 't2', name: 'web_search', input: { q: 'a' } },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    const group = done.segments.find((segment) => segment.kind === 'tool-group');
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;

    expect(group.timeline.map((item) => item.type)).toEqual([
      'thinking',
      'tool',
      'thinking',
      'tool',
    ]);
  });

  it('merges supplemental streaming tools when messages lack tool_use blocks', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来查询天气。' },
          { type: 'thinking', thinking: '准备调用工具' },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      streamingTools: [
        { toolCallId: 't1', name: 'exec', input: { cmd: 'curl wttr.in' } },
        { toolCallId: 't2', name: 'web_search', input: { q: 'weather' } },
      ],
    });

    const group = live.segments.find((segment) => segment.kind === 'tool-group');
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;

    expect(group.timeline.filter((item) => item.type === 'tool')).toHaveLength(2);
    expect(
      group.timeline.find((item) => item.type === 'tool' && item.id === 't1')?.input,
    ).toEqual({ cmd: 'curl wttr.in' });
  });

  it('queues then places mid-run short text before streaming tool group', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我来为你查询上海未来7天的天气预报。' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '让我获取更完整的 7 天预报：' }],
      },
    ];

    expect(pickTimelineSourceMessages(messages)).toHaveLength(2);

    const live = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      streamingTools: [{ toolCallId: 't1', name: 'exec', input: { cmd: 'a' } }],
      engineProfile: 'claude',
    });

    expect(live.segments.map((segment) => segment.kind)).toEqual([
      'tool-group',
      'phase-text',
      'phase-text',
    ]);
    expect(live.segments[0]).toMatchObject({ kind: 'tool-group' });
    expect(live.segments[1]).toMatchObject({
      kind: 'phase-text',
      text: '我来为你查询上海未来7天的天气预报。',
    });
    expect(live.segments[2]).toMatchObject({
      kind: 'phase-text',
      text: '让我获取更完整的 7 天预报：',
    });
  });

  it('interleaves supplemental streaming tools with accumulated thinking blocks', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '思考 1' },
          { type: 'thinking', thinking: '思考 2' },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      streamingTools: [
        { toolCallId: 't1', name: 'exec', input: { n: 1 } },
        { toolCallId: 't2', name: 'web_search', input: { q: 'a' } },
      ],
    });

    const group = live.segments.find((segment) => segment.kind === 'tool-group');
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;

    expect(group.timeline.map((item) => item.type)).toEqual([
      'thinking',
      'tool',
      'thinking',
      'tool',
    ]);
  });

  it('does not place streamed deliverable reply above thinking (Claude text-before-thinking)', () => {
    const table =
      '## 📍 上海最近 3 天天气预报\n\n| 日期 | 时段 | 天气 | 温度 |\n| --- | --- | --- | --- |\n| 7月2日 周四 | 全天 | 晴 | 28°C |';
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: table }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: table },
          { type: 'thinking', thinking: '用户要最近 3 天的天气，直接整理前 3 天回复即可。' },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(live.segments.filter((segment) => segment.kind === 'phase-text')).toHaveLength(0);
    expect(live.finalReplyText).toContain('上海最近 3 天天气预报');
    expect(
      live.segments.some(
        (segment) =>
          segment.kind === 'tool-group'
          && segment.timeline.some((item) => item.type === 'thinking'),
      ),
    ).toBe(true);

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    expect(done.finalReplyText).toContain('上海最近 3 天天气预报');
    expect(done.segments.filter((segment) => segment.kind === 'phase-text')).toHaveLength(0);
  });

  it('keeps short opening narration as phase-text before tools', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来为你查询上海未来 7 天的天气预报。' },
          { type: 'thinking', thinking: '先拉 wttr.in 数据' },
          { type: 'tool_use', id: 't1', name: 'exec', input: {} },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(live.segments[0]).toMatchObject({
      kind: 'phase-text',
      text: '我来为你查询上海未来 7 天的天气预报。',
    });
    expect(live.finalReplyText).toBeNull();
  });

  it('routes mid-turn deliverable table to finalReply after tools, keeps short phase text', () => {
    const draftTable =
      '根据我已获取的数据，让我为您整理上海未来 7 天天气预报。\n\n| 日期 | 天气 | 温度 |\n| --- | --- | --- |\n| 7月2日 | 晴 | 28°C |';
    const finalTable = `${draftTable}\n\n## 天气趋势分析\n\n未来三天以晴为主。`;
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先查 wttr.in' },
          { type: 'tool_use', id: 't1', name: 'exec', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '让我用英文格式获取完整的 7 天数据：' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '换 MCP 试试' },
          { type: 'tool_use', id: 't2', name: 'web_search', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: draftTable }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: finalTable }],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    const phaseTexts = live.segments.filter((segment) => segment.kind === 'phase-text');
    expect(phaseTexts).toHaveLength(1);
    expect(phaseTexts[0]?.kind === 'phase-text' && phaseTexts[0].text).toContain('英文格式');
    expect(live.finalReplyText).toContain('天气趋势分析');
    expect(
      live.segments.some(
        (segment) =>
          segment.kind === 'phase-text'
          && segment.text.includes('| 日期 |'),
      ),
    ).toBe(false);

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    expect(done.finalReplyText).toContain('天气趋势分析');
    expect(
      done.segments.filter((segment) => segment.kind === 'phase-text').every(
        (segment) => segment.kind !== 'phase-text' || !segment.text.includes('| 日期 |'),
      ),
    ).toBe(true);
  });

  it('interleaves OpenClaw live narration between tool groups, not at tail', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来帮你分析申通快递近半年的单量数据。' },
          { type: 'thinking', thinking: '先找 finance 命令' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'help' } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '找到了 finance guanbao template 命令，接下来查询单量。' },
          { type: 'thinking', thinking: '执行查询' },
          { type: 'tool_use', id: 't2', name: 'exec', input: { cmd: 'query' } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '数据已拿到，开始整理 HTML 报告。' },
          { type: 'thinking', thinking: '读取结果文件' },
          { type: 'tool_use', id: 't3', name: 'read', input: { path: '/tmp/out.html' } },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(live.segments.map((segment) => segment.kind)).toEqual([
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
    ]);
    expect(live.finalReplyText).toBeNull();
  });

  it('places OpenClaw intra-snapshot narration as phase-text between tool groups', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '读技能文档' },
          { type: 'tool_use', id: 'read-1', name: 'read', input: { path: 'SKILL.md' } },
          {
            type: 'text',
            text: '天气技能主要用于当前和预报，历史数据我用 Open-Meteo 的免费历史天气 API 来获取。',
          },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      streamingTools: [
        {
          id: 'read-1',
          name: 'read',
          status: 'completed',
          input: { path: 'SKILL.md' },
        },
      ],
    });

    expect(live.segments.map((segment) => segment.kind)).toEqual([
      'tool-group',
      'phase-text',
    ]);
    const phase = live.segments.find((segment) => segment.kind === 'phase-text');
    expect(phase?.kind === 'phase-text' && phase.text).toContain('Open-Meteo');
    const group = live.segments.find((segment) => segment.kind === 'tool-group');
    expect(group?.kind === 'tool-group' && group.state).toBe('completed');
  });

  it('dedupes Claude streamingTools against message tool_use (no phantom duplicates)', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '联网搜索申通单量' },
          {
            type: 'tool_use',
            id: 'toolu_real',
            name: 'web_search',
            input: { query: '申通快递 2025年 全年业务量' },
          },
        ],
      },
    ];

    const phantomStreaming = Array.from({ length: 12 }, () => ({
      id: 'web_search',
      name: 'web_search',
      input: null,
    }));

    const live = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      streamingTools: phantomStreaming,
    });

    const group = live.segments.find((segment) => segment.kind === 'tool-group');
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;

    const tools = group.timeline.filter((item) => item.type === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('web_search');
    expect(tools[0]?.input).toEqual({ query: '申通快递 2025年 全年业务量' });

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    const doneGroup = done.segments.find((segment) => segment.kind === 'tool-group');
    expect(
      doneGroup?.kind === 'tool-group'
        && doneGroup.timeline.filter((item) => item.type === 'tool').length,
    ).toBe(1);
  });

  it('preserves distinct stable tool calls with the same name', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_a', name: 'web_search', input: { q: 'a' } },
          { type: 'tool_use', id: 'toolu_b', name: 'web_search', input: { q: 'b' } },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    const group = done.segments.find((segment) => segment.kind === 'tool-group');
    expect(
      group?.kind === 'tool-group'
        && group.timeline.filter((item) => item.type === 'tool').length,
    ).toBe(2);
  });

  it('collapses redundant Claude thinking blocks before a single tool arrives', () => {
    const snapshots = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先读取工作区文件。' },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先读取工作区文件。' },
          { type: 'thinking', thinking: '先读取工作区文件，确认是否有周报模板。' },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先读取工作区文件。' },
          { type: 'thinking', thinking: '先读取工作区文件，确认是否有周报模板。' },
          {
            type: 'thinking',
            thinking: '先读取工作区文件，确认是否有周报模板或技能目录。',
          },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
        ],
      },
    ];

    const counts = snapshots.map((snapshot) => {
      const layout = parseThinkingTurnLayout([snapshot], { isLiveStream: true });
      const group = layout.segments.find((segment) => segment.kind === 'tool-group');
      if (group?.kind !== 'tool-group') return 0;
      return group.timeline.filter((item) => item.type === 'thinking').length;
    });

    expect(counts).toEqual([1, 1, 1]);
  });

  it('keeps stable opening phase-text key while stream grows (no remount flicker)', () => {
    const partial = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我来帮你生成周报PPT。' }],
      },
    ];
    const withThinkingAndLongerOpening = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我来帮你生成周报PPT。' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '先检查模板' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来帮你生成周报PPT。不过我需要了解一些信息才能生成：' },
          { type: 'thinking', thinking: '先检查模板' },
        ],
      },
    ];

    const live1 = parseThinkingTurnLayout(partial, { isLiveStream: true });
    const live2 = parseThinkingTurnLayout(withThinkingAndLongerOpening, { isLiveStream: true });
    const opening1 = live1.segments.find((segment) => segment.kind === 'phase-text');
    const opening2 = live2.segments.find((segment) => segment.kind === 'phase-text');

    expect(opening1?.kind === 'phase-text' && opening1.key).toBe(OPENING_PHASE_TEXT_KEY);
    expect(opening2?.kind === 'phase-text' && opening2.key).toBe(OPENING_PHASE_TEXT_KEY);
    expect(opening2?.kind === 'phase-text' && opening2.text).toContain('不过我需要了解');
    expect(live2.segments.filter((segment) => segment.kind === 'phase-text')).toHaveLength(1);
  });

  it('keeps long Claude planning narration as top phase-text before tool group', () => {
    const longNarration =
      '我来为您生成一份核心指标概览（关键 KPI 一页通）的 PPT 页面。基于网点运营的典型场景，我将使用模拟数据展示关键运营指标。让我使用正确的 PPTX 技能来生成：现在我来创建一份专业的核心指标概览 PPT。我将使用 pptxgenjs 创建一个设计精良的 KPI 仪表板页面。';
    const thinkings = Array.from({ length: 13 }, (_, index) => ({
      type: 'thinking' as const,
      thinking: `规划步骤 ${index + 1}：准备 KPI 数据与版式`,
    }));
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: longNarration },
          ...thinkings,
          { type: 'tool_use', id: 't1', name: 'pptx', input: {} },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(live.finalReplyText).toBeNull();
    expect(live.segments.map((segment) => segment.kind)).toEqual([
      'phase-text',
      'tool-group',
    ]);

    const opening = live.segments[0];
    expect(opening?.kind).toBe('phase-text');
    if (opening?.kind !== 'phase-text') return;
    expect(opening.text).toContain('核心指标概览');

    const group = live.segments[1];
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;
    expect(group.timeline.filter((item) => item.type === 'thinking').length).toBeLessThanOrEqual(2);
    expect(group.timeline.filter((item) => item.type === 'tool')).toHaveLength(1);
  });

  it('collapses extra bundled thinkings after a single tool', () => {
    const thinkings = Array.from({ length: 8 }, (_, index) => ({
      type: 'thinking' as const,
      thinking: `思考 ${index + 1}`,
    }));
    const messages = [
      {
        role: 'assistant',
        content: [
          ...thinkings,
          { type: 'tool_use', id: 't1', name: 'exec', input: { n: 1 } },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    const group = done.segments.find((segment) => segment.kind === 'tool-group');
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;

    expect(group.timeline.filter((item) => item.type === 'thinking').length).toBeLessThanOrEqual(2);
    expect(group.timeline.filter((item) => item.type === 'tool')).toHaveLength(1);
  });

  it('places Claude pre-thinking narration below thinking-only summary (not above)', () => {
    const intro = '我需要先了解一些信息来为您生成业务指标周报 PPT：';
    const finalReply =
      '请告诉我：\n\n1. **指标类型**：您希望展示哪些业务指标？\n2. **时间范围**：周报覆盖哪一周？';
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: intro }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: intro },
          { type: 'thinking', thinking: '先确认指标范围与时间窗口。' },
          { type: 'thinking', thinking: '整理成追问清单再回复用户。' },
          { type: 'text', text: finalReply },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, {
      isLiveStream: false,
      engineProfile: 'claude',
    });
    expect(done.segments.map((segment) => segment.kind)).toEqual([
      'tool-group',
      'phase-text',
    ]);
    expect(done.finalReplyText).toContain('指标类型');
    const group = done.segments[0];
    const phase = done.segments[1];
    expect(group?.kind).toBe('tool-group');
    expect(phase?.kind).toBe('phase-text');
    if (group?.kind !== 'tool-group' || phase?.kind !== 'phase-text') return;
    expect(group.timeline.filter((item) => item.type === 'thinking')).toHaveLength(2);
    expect(phase.text).toBe(intro);

    const live = parseThinkingTurnLayout(
      [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: intro },
            { type: 'thinking', thinking: '先确认指标范围与时间窗口。' },
            { type: 'thinking', thinking: '整理成追问清单再回复用户。' },
          ],
        },
      ],
      {
        isLiveStream: true,
        engineProfile: 'claude',
      },
    );
    expect(live.segments.map((segment) => segment.kind)).toEqual([
      'tool-group',
      'phase-text',
    ]);
  });

  it('keeps Claude opening narration below first tool-group during live stream (no jump)', () => {
    const intro = '我需要先了解一些信息来为您生成业务指标周报 PPT：';
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: intro }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: intro },
          { type: 'thinking', thinking: '先确认数据源与模板。' },
          { type: 'tool_use', id: 't1', name: 'read', input: { path: 'SKILL.md' } },
        ],
      },
    ];

    const partial = parseThinkingTurnLayout([messages[0]!], {
      isLiveStream: true,
      engineProfile: 'claude',
    });
    // Claude 图二：opening 等首个摘要出现后再露出，避免先顶在「思考 N 次」上方
    expect(partial.segments.map((segment) => segment.kind)).toEqual([]);

    const live = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      engineProfile: 'claude',
    });
    expect(live.segments.map((segment) => segment.kind)).toEqual([
      'tool-group',
      'phase-text',
    ]);
    const group = live.segments[0];
    const phase = live.segments[1];
    expect(group?.kind).toBe('tool-group');
    expect(phase?.kind).toBe('phase-text');
    if (group?.kind !== 'tool-group' || phase?.kind !== 'phase-text') return;
    expect(group.state).toBe('active');
    expect(group.timeline.filter((item) => item.type === 'tool')).toHaveLength(1);
    expect(phase.text).toBe(intro);
  });

  it('mis-infers Claude mixed snapshot as OpenClaw without explicit engineProfile', () => {
    const intro = '我需要先了解一些信息来为您生成业务指标周报 PPT：';
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: intro }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: intro },
          { type: 'thinking', thinking: '先确认数据源与模板。' },
          { type: 'tool_use', id: 't1', name: 'read', input: { path: 'SKILL.md' } },
        ],
      },
    ];

    const inferred = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(inferred.segments.map((segment) => segment.kind)).toEqual([
      'phase-text',
      'tool-group',
    ]);

    const explicitClaude = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      engineProfile: 'claude',
    });
    expect(explicitClaude.segments.map((segment) => segment.kind)).toEqual([
      'tool-group',
      'phase-text',
    ]);
  });

  it('drops opening phase-text that echoes the preceding user query (OpenClaw)', () => {
    const userQuery = '生成业务指标的周报PPT';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: userQuery },
          { type: 'thinking', thinking: '我需要先了解业务指标的具体数据内容。' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'query' } },
        ],
      },
    ];

    const withoutDedupe = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(withoutDedupe.segments.some(
      (s) => s.kind === 'phase-text' && s.text.trim() === userQuery,
    )).toBe(true);

    const withDedupe = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      precedingUserText: userQuery,
    });
    expect(withDedupe.segments.some(
      (s) => s.kind === 'phase-text' && s.text.trim() === userQuery,
    )).toBe(false);
    expect(withDedupe.segments.some((s) => s.kind === 'tool-group')).toBe(true);
  });

  it('drops user echo after figure-two rebuild in done state (OpenClaw)', () => {
    const userQuery = '生成业务指标的周报PPT';
    const narration = '我需要先了解业务指标数据从哪里获取。让我检查一下是否有相关的配置或数据源。';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: userQuery },
          { type: 'text', text: narration },
          { type: 'thinking', thinking: '先查配置' },
          { type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'a' } },
          { type: 'text', text: '让我使用 sai-cli 查询业务指标相关的数据：' },
          { type: 'thinking', thinking: '查 sai-cli' },
          { type: 'tool_use', id: 't2', name: 'sai-cli', input: {} },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, {
      isLiveStream: false,
      precedingUserText: userQuery,
    });
    expect(
      done.segments.some(
        (segment) => segment.kind === 'phase-text' && segment.text.trim() === userQuery,
      ),
    ).toBe(false);
    expect(
      done.segments.some(
        (segment) => segment.kind === 'phase-text' && segment.text.includes('业务指标数据'),
      ),
    ).toBe(true);
  });

  it('keeps distinct stable keys for adjacent phase-text segments after a tool group (done rebuild)', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来帮你查天气，先拉一下数据。' },
          { type: 'thinking', thinking: '先拉数据' },
          { type: 'tool_use', id: 't1', name: 'exec', input: {} },
          { type: 'tool_use', id: 't2', name: 'exec', input: {} },
          { type: 'text', text: '让我换一个工具试试。' },
          { type: 'text', text: '改用 deep-research 检索补充。' },
          { type: 'thinking', thinking: '换工具' },
          { type: 'tool_use', id: 't3', name: 'web_search', input: {} },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    const phaseTexts = done.segments.filter(
      (segment): segment is Extract<typeof segment, { kind: 'phase-text' }> =>
        segment.kind === 'phase-text',
    );
    expect(phaseTexts).toHaveLength(3);
    const keys = phaseTexts.map((segment) => segment.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(OPENING_PHASE_TEXT_KEY);
    expect(done.segments.filter((s) => s.kind === 'tool-group')).toHaveLength(2);
  });
});

describe('rebalanceThinkingTimelineForDisplay', () => {
  it('does not shorten timeline when interleaving would merge tail thinkings', () => {
    const bundled: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'a' },
      { type: 'thinking', content: 'b' },
      { type: 'thinking', content: 'c' },
      { type: 'thinking', content: 'd' },
      { type: 'thinking', content: 'e' },
      { type: 'tool', index: 1, id: 't1', name: 'exec', input: {} },
      { type: 'tool', index: 2, id: 't2', name: 'exec', input: {} },
      { type: 'tool', index: 3, id: 't3', name: 'exec', input: {} },
    ];

    const result = rebalanceThinkingTimelineForDisplay(bundled);
    expect(result).toHaveLength(bundled.length);
  });

  it('still interleaves bundled think×N + tool×M when length is not reduced', () => {
    const bundled: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'a' },
      { type: 'thinking', content: 'b' },
      { type: 'tool', index: 1, id: 't1', name: 'exec', input: {} },
      { type: 'tool', index: 2, id: 't2', name: 'exec', input: {} },
    ];

    const result = rebalanceThinkingTimelineForDisplay(bundled);
    expect(result[0]).toMatchObject({ type: 'thinking', content: 'a' });
    expect(result[1]).toMatchObject({ type: 'tool', id: 't1' });
    expect(result[2]).toMatchObject({ type: 'thinking', content: 'b' });
    expect(result[3]).toMatchObject({ type: 'tool', id: 't2' });
  });
});

describe('batch interrupt phase-text (图二)', () => {
  it('shows interrupt narration between adjacent thinking-only and tools-only summaries (workflow stream)', () => {
    const interrupt = '正在拉取工作流参数表单。';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '找模板' },
          { type: 'thinking', thinking: '确认 schema' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '找模板' },
          { type: 'thinking', thinking: '确认 schema' },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: interrupt }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
          { type: 'tool_use', id: 't2', name: 'get_workflow_schema', input: {} },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    const groups = live.segments.filter((s) => s.kind === 'tool-group');
    const phaseBetween = live.segments.find(
      (segment, index) =>
        segment.kind === 'phase-text'
        && live.segments[index - 1]?.kind === 'tool-group'
        && live.segments[index + 1]?.kind === 'tool-group',
    );
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(phaseBetween).toMatchObject({ kind: 'phase-text', text: interrupt });
  });

  it('rebuilds interrupt phase-text when adjacent summaries lack narration segment (multi-snapshot gap)', () => {
    const interrupt = '正在拉取工作流参数表单。';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '找模板' },
          { type: 'thinking', thinking: '确认 schema' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '找模板' },
          { type: 'thinking', thinking: '确认 schema' },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '找模板' },
          { type: 'thinking', thinking: '确认 schema' },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
          { type: 'text', text: interrupt },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
          { type: 'tool_use', id: 't2', name: 'get_workflow_schema', input: {} },
          { type: 'tool_use', id: 't3', name: 'validate', input: {} },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    const phaseBetween = live.segments.find(
      (segment, index) =>
        segment.kind === 'phase-text'
        && live.segments[index - 1]?.kind === 'tool-group'
        && live.segments[index + 1]?.kind === 'tool-group',
    );
    expect(phaseBetween).toMatchObject({ kind: 'phase-text', text: interrupt });
    const lastSegment = live.segments[live.segments.length - 1];
    expect(lastSegment?.kind).not.toBe('phase-text');
  });

  it('keeps long interrupt narration between tool batches during live stream', () => {
    const interrupt =
      '脚本本身已经有 SSL 证书失败的重试降级逻辑，让我换 MCP 工具。';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来查询天气。' },
          { type: 'tool_use', id: 't1', name: 'exec', input: {} },
          { type: 'tool_use', id: 't2', name: 'exec', input: {} },
          { type: 'text', text: interrupt },
          { type: 'tool_use', id: 't3', name: 'web_search', input: {} },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    const groups = live.segments.filter((s) => s.kind === 'tool-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ state: 'completed' });
    expect(groups[1]).toMatchObject({ state: 'active' });

    const phaseBetween = live.segments.find(
      (s, i) =>
        s.kind === 'phase-text'
        && i > 0
        && live.segments[i - 1]?.kind === 'tool-group'
        && live.segments[i + 1]?.kind === 'tool-group',
    );
    expect(phaseBetween).toMatchObject({ kind: 'phase-text', text: interrupt });
  });

  it('preserves interrupt phase-text and batch counts after turn completes', () => {
    const interrupt = '让我换 MCP 工具继续查。';
    const finalReply = '| 日期 | 天气 |\n| --- | --- |';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来查询。' },
          { type: 'thinking', thinking: 'a' },
          { type: 'tool_use', id: 't1', name: 'exec', input: {} },
          { type: 'text', text: interrupt },
          { type: 'thinking', thinking: 'b' },
          { type: 'tool_use', id: 't2', name: 'web_search', input: {} },
          { type: 'text', text: finalReply },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    expect(done.finalReplyText).toContain('日期');
    expect(done.segments.filter((s) => s.kind === 'tool-group').length).toBeGreaterThanOrEqual(1);
    expect(
      done.segments.some(
        (s) => s.kind === 'phase-text' && s.text.includes('MCP'),
      ),
    ).toBe(true);
  });

  it('done：assistant snapshot 无 tool_use 时从 tool_result 恢复工具', () => {
    const phaseA = '我来查询上海未来 8 天的天气预报。';
    const phaseB = '我来为您获取更完整的 8 天预报：';
    const messages = [
      {
        id: 'snap-a',
        role: 'assistant',
        content: [
          { type: 'text', text: phaseA },
          { type: 'thinking', thinking: '规划查询 wttr.in' },
          { type: 'thinking', thinking: '准备 curl 请求' },
        ],
      },
      {
        id: 'tr-1',
        role: 'toolresult',
        toolCallId: 'toolu_1',
        toolName: 'Bash',
        content: 'ok',
        status: 'completed',
      },
      {
        id: 'snap-b',
        role: 'assistant',
        content: [
          { type: 'text', text: phaseB },
          { type: 'thinking', thinking: '换 Open-Meteo' },
          { type: 'thinking', thinking: '整理表格' },
        ],
      },
      {
        id: 'tr-2',
        role: 'toolresult',
        toolCallId: 'toolu_2',
        toolName: 'web_search',
        content: 'results',
        status: 'completed',
      },
      {
        id: 'final',
        role: 'assistant',
        content: [{ type: 'text', text: '根据检索到的天气预报数据，表格如下。' }],
      },
    ];

    const chronologicalEntries = [
      { kind: 'assistant' as const, message: messages[0]! },
      { kind: 'tool-result' as const, message: messages[1]! },
      { kind: 'assistant' as const, message: messages[2]! },
      { kind: 'tool-result' as const, message: messages[3]! },
      { kind: 'assistant' as const, message: messages[4]! },
    ];

    const done = parseThinkingTurnLayout(
      messages.filter((message) => message.role === 'assistant'),
      {
        isLiveStream: false,
        engineProfile: 'claude',
        chronologicalEntries,
      },
    );

    const groups = done.segments.filter(
      (segment): segment is Extract<typeof segment, { kind: 'tool-group' }> =>
        segment.kind === 'tool-group',
    );
    const toolCount = groups.reduce(
      (count, group) => count + group.timeline.filter((item) => item.type === 'tool').length,
      0,
    );
    expect(toolCount).toBeGreaterThanOrEqual(2);
    expect(
      groups.some((group) =>
        group.timeline.some((item) => item.type === 'tool' && item.name === 'Bash'),
      ),
    ).toBe(true);
    expect(
      groups.some((group) =>
        group.timeline.some((item) => item.type === 'tool' && item.name === 'web_search'),
      ),
    ).toBe(true);
  });

  it('does not create a second thinking-only summary after final reply without short text break', () => {
    const intro =
      '已找到「客户异常监控」工作流模板，客户端将自动弹出分步参数表单，请在下方表单中逐步确认以下内容：\n\n'
      + '**数据来源**：选择发件基础信息和/或服务质量信息';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '搜索工作流模板并拉取 schema' },
          { type: 'tool_use', id: 'wf-schema', name: 'get_workflow_schema', input: {} },
          { type: 'text', text: intro },
          { type: 'thinking', thinking: '等待用户在参数表单中逐步确认' },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, { isLiveStream: false });
    const groups = done.segments.filter((segment) => segment.kind === 'tool-group');

    expect(groups).toHaveLength(1);
    expect(done.finalReplyText).toContain('已找到「客户异常监控」');
    expect(groups[0]?.kind).toBe('tool-group');
    if (groups[0]?.kind !== 'tool-group') return;
    expect(groups[0].timeline.filter((item) => item.type === 'tool')).toHaveLength(1);
  });
});
