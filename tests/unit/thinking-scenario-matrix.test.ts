/**
 * 思考模式 × 引擎 × 业务场景 矩阵测试
 *
 * 对照 docs/thinking-process-interaction.md 四图语义：
 * - phase-text 与 tool-group 交替（或 live 单批 active）
 * - 最终正文不进 phase-text
 * - live→done 工具条数不骤降（Claude weak-id / streaming 烘焙）
 */
import { describe, expect, it } from 'vitest';
import {
  appendStreamingExtrasToTimeline,
  mergeTimelineMonotonic,
} from '@/lib/thinking-timeline-active';
import {
  buildThinkingGroupSummaryLabel,
  parseThinkingTurnLayout,
} from '@/pages/Chat/thinking-turn-segments';

type Engine = 'openclaw' | 'claude';

function toolCount(layout: ReturnType<typeof parseThinkingTurnLayout>): number {
  return layout.segments
    .filter((s) => s.kind === 'tool-group')
    .flatMap((s) => (s.kind === 'tool-group' ? s.timeline : []))
    .filter((item) => item.type === 'tool').length;
}

function assertFinalReplySeparated(
  layout: ReturnType<typeof parseThinkingTurnLayout>,
  replyNeedle: string,
): void {
  expect(layout.finalReplyText).toContain(replyNeedle);
  expect(
    layout.segments.every(
      (s) => s.kind !== 'phase-text' || !s.text.includes(replyNeedle.slice(0, 20)),
    ),
  ).toBe(true);
}

function assertNoTableInPhaseText(layout: ReturnType<typeof parseThinkingTurnLayout>): void {
  expect(
    layout.segments.every(
      (s) => s.kind !== 'phase-text' || !s.text.includes('| --- |'),
    ),
  ).toBe(true);
}

describe('thinking scenario matrix', () => {
  describe('OpenClaw', () => {
    it('正常文本问答：申通单量分析 live 旁白↔工具交替', () => {
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
            { type: 'text', text: '找到了 finance 命令，接下来查询单量。' },
            { type: 'thinking', thinking: '执行查询' },
            { type: 'tool_use', id: 't2', name: 'exec', input: { cmd: 'query' } },
            { type: 'text', text: '根据数据整理结论如下：\n\n近半年单量呈上升趋势。' },
          ],
        },
      ];

      const live = parseThinkingTurnLayout(messages.slice(0, 1), {
        isLiveStream: true,
        engineProfile: 'openclaw',
      });
      expect(live.segments.map((s) => s.kind)).toEqual(['phase-text', 'tool-group']);
      expect(live.finalReplyText).toBeNull();

      const done = parseThinkingTurnLayout(messages, {
        isLiveStream: false,
        engineProfile: 'openclaw',
      });
      assertFinalReplySeparated(done, '近半年单量');
      expect(toolCount(done)).toBeGreaterThanOrEqual(2);
      assertNoTableInPhaseText(done);
    });

    it('HTML 产物：读结果文件 + 阶段旁白', () => {
      const messages = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '数据已拿到，开始整理 HTML 报告。' },
            { type: 'thinking', thinking: '读取 sto-distinctive-design SKILL' },
            { type: 'tool_use', id: 't1', name: 'read', input: { path: 'SKILL.md' } },
            { type: 'tool_use', id: 't2', name: 'write', input: { path: 'report.html' } },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '数据已拿到，开始整理 HTML 报告。' },
            { type: 'thinking', thinking: '读取 sto-distinctive-design SKILL' },
            { type: 'tool_use', id: 't1', name: 'read', input: { path: 'SKILL.md' } },
            { type: 'tool_use', id: 't2', name: 'write', input: { path: 'report.html' } },
            { type: 'text', text: '<!DOCTYPE html><html><body>申通单量报告</body></html>' },
          ],
        },
      ];

      const live = parseThinkingTurnLayout(messages.slice(0, 1), {
        isLiveStream: true,
        engineProfile: 'openclaw',
      });
      expect(toolCount(live)).toBe(2);

      const done = parseThinkingTurnLayout(messages, {
        isLiveStream: false,
        engineProfile: 'openclaw',
      });
      expect(toolCount(done)).toBeGreaterThanOrEqual(2);
      expect(done.finalReplyText).toContain('<!DOCTYPE html>');
    });

    it('工作流启动：execute_workflow 工具进 thinking 摘要', () => {
      const messages = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '正在为您启动客户异常监控工作流。' },
            { type: 'thinking', thinking: '查 schema 并提交参数' },
            {
              type: 'tool_use',
              id: 'tw1',
              name: 'execute_workflow',
              input: { workflowId: 'wf_abc' },
            },
            {
              type: 'tool_use',
              id: 'tw2',
              name: 'get_workflow_schema',
              input: { templateId: 'tpl_1' },
            },
          ],
        },
      ];

      const live = parseThinkingTurnLayout(messages, {
        isLiveStream: true,
        engineProfile: 'openclaw',
      });
      const group = live.segments.find((s) => s.kind === 'tool-group');
      expect(group?.kind).toBe('tool-group');
      if (group?.kind !== 'tool-group') return;
      expect(group.timeline.filter((i) => i.type === 'tool')).toHaveLength(2);
      expect(group.state).toBe('active');
    });
  });

  describe('Claude', () => {
    it('正常文本：多轮 text-only 后 batched tools（PPT 前置追问）', () => {
      const intro = '我来帮您生成 PPT，先获取天气数据。';
      const messages = [
        { role: 'assistant', content: [{ type: 'text', text: intro }] },
        { role: 'assistant', content: [{ type: 'text', text: '数据不够，换 deep-research。' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '准备调用工具' },
            { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
            { type: 'tool_use', id: 'toolu_2', name: 'exec', input: {} },
            { type: 'text', text: '已整理完毕，请查看下方表格。\n\n| 指标 | 数值 |\n| --- | --- |' },
          ],
        },
      ];

      const live = parseThinkingTurnLayout(messages.slice(0, 2), {
        isLiveStream: true,
        engineProfile: 'claude',
      });
      expect(live.finalReplyText).toBeNull();

      const done = parseThinkingTurnLayout(messages, {
        isLiveStream: false,
        engineProfile: 'claude',
      });
      assertFinalReplySeparated(done, '| 指标 |');
      expect(toolCount(done)).toBeGreaterThanOrEqual(2);
    });

    it('PPT 产物：长旁白 + 多 thinking + pptx 工具', () => {
      const longNarration =
        '我来为您生成核心指标概览 PPT，将使用 pptxgenjs 创建 KPI 仪表板。';
      const messages = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: longNarration },
            { type: 'thinking', thinking: '规划步骤 1' },
            { type: 'thinking', thinking: '规划步骤 2' },
            { type: 'tool_use', id: 'toolu_ppt', name: 'pptx', input: { title: 'KPI' } },
            { type: 'tool_use', id: 'toolu_w', name: 'write', input: { path: 'deck.pptx' } },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: longNarration },
            { type: 'thinking', thinking: '规划步骤 1' },
            { type: 'thinking', thinking: '规划步骤 2' },
            { type: 'tool_use', id: 'toolu_ppt', name: 'pptx', input: { title: 'KPI' } },
            { type: 'tool_use', id: 'toolu_w', name: 'write', input: { path: 'deck.pptx' } },
            { type: 'text', text: 'PPT 已生成，路径：/tmp/deck.pptx' },
          ],
        },
      ];

      const live = parseThinkingTurnLayout(messages.slice(0, 1), {
        isLiveStream: true,
        engineProfile: 'claude',
      });
      expect(live.segments.some((s) => s.kind === 'tool-group')).toBe(true);
      expect(toolCount(live)).toBe(2);

      const done = parseThinkingTurnLayout(messages, {
        isLiveStream: false,
        engineProfile: 'claude',
      });
      expect(toolCount(done)).toBeGreaterThanOrEqual(2);
      expect(done.finalReplyText).toContain('deck.pptx');
    });

    it('live→done：weak-id 多次 exec 工具条数保留', () => {
      const messages = [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '批量查询' },
            { type: 'tool_use', id: 'exec', name: 'exec', input: { n: 1 } },
            { type: 'tool_use', id: 'exec', name: 'exec', input: { n: 2 } },
            { type: 'tool_use', id: 'exec', name: 'exec', input: { n: 3 } },
            { type: 'tool_use', id: 'exec', name: 'exec', input: { n: 4 } },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '批量查询' },
            { type: 'tool_use', id: 'exec', name: 'exec', input: { n: 1 } },
            { type: 'tool_use', id: 'exec', name: 'exec', input: { n: 2 } },
            { type: 'text', text: '查询完成。' },
          ],
        },
      ];

      const live = parseThinkingTurnLayout(messages.slice(0, 1), {
        isLiveStream: true,
        engineProfile: 'claude',
        streamingTools: [
          { toolCallId: 's1', name: 'exec', input: { n: 3 } },
          { toolCallId: 's2', name: 'exec', input: { n: 4 } },
        ],
      });
      const liveTools = toolCount(live);
      expect(liveTools).toBeGreaterThanOrEqual(4);

      const baked = appendStreamingExtrasToTimeline(
        live.segments.find((s) => s.kind === 'tool-group')?.kind === 'tool-group'
          ? live.segments.find((s) => s.kind === 'tool-group')!.timeline
          : [],
        [
          { toolCallId: 's1', name: 'exec', input: { n: 3 } },
          { toolCallId: 's2', name: 'exec', input: { n: 4 } },
        ],
      );
      const doneParse = parseThinkingTurnLayout(messages.slice(1), {
        isLiveStream: false,
        engineProfile: 'claude',
      });
      const merged = mergeTimelineMonotonic(baked, doneParse.segments.find((s) => s.kind === 'tool-group')?.kind === 'tool-group'
        ? doneParse.segments.find((s) => s.kind === 'tool-group')!.timeline
        : []);
      expect(merged.filter((i) => i.type === 'tool').length).toBeGreaterThanOrEqual(liveTools - 1);
    });

    it('定时任务 / 任务执行：create_claude_scheduled_task 工具', () => {
      const messages = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '正在创建定时任务。' },
            { type: 'thinking', thinking: '校验 cron 表达式' },
            {
              type: 'tool_use',
              id: 'toolu_task',
              name: 'create_claude_scheduled_task',
              input: { cron: '0 9 * * 1' },
            },
          ],
        },
      ];

      const layout = parseThinkingTurnLayout(messages, {
        isLiveStream: true,
        engineProfile: 'claude',
      });
      expect(toolCount(layout)).toBe(1);
      const group = layout.segments.find((s) => s.kind === 'tool-group');
      expect(group?.kind).toBe('tool-group');
    });
  });

  describe('双引擎共性', () => {
    const engines: Engine[] = ['openclaw', 'claude'];

    for (const engine of engines) {
      it(`${engine}：有 tool 时摘要 label 含工具次数`, () => {
        const messages = [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'test' },
              { type: 'tool_use', id: 'a', name: 'read', input: {} },
              { type: 'tool_use', id: 'b', name: 'exec', input: {} },
            ],
          },
        ];
        const layout = parseThinkingTurnLayout(messages, {
          isLiveStream: false,
          engineProfile: engine,
        });
        const group = layout.segments.find((s) => s.kind === 'tool-group');
        expect(group?.kind).toBe('tool-group');
        if (group?.kind !== 'tool-group') return;

        const label = buildThinkingGroupSummaryLabel(group.timeline, (key, opts) => {
          if (key === 'streaming.collapsedSummary') {
            return `思考 ${opts?.thoughtCount} 次，使用 ${opts?.toolCount} 个工具`;
          }
          return key;
        });
        expect(label).toContain('2');
      });
    }
  });
});
