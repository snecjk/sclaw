import { describe, expect, it } from 'vitest';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';

/** 申通单量报告：多轮 text → think+tool 交替（消息边界干净） */
const STO_EXPRESS_MESSAGES = [
  {
    role: 'assistant',
    content: [{ type: 'text', text: '我来帮你分析申通快递近半年的单量数据并生成报告。' }],
  },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '思考A' },
      { type: 'thinking', thinking: '思考B' },
      { type: 'tool_use', id: 't1', name: 'dws', input: {} },
    ],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '我需要先获取申通快递近半年的单量数据。让我使用 dws 工具来查询相关数据。',
      },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '思考C' },
      { type: 'tool_use', id: 't2', name: 'exec', input: {} },
    ],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '我需要获取申通快递的单量数据。让我先检查可用的数据源。',
      },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '思考D' },
      { type: 'tool_use', id: 't3', name: 'exec', input: { cmd: 'finance' } },
    ],
  },
];

function segmentLabels(segments: ReturnType<typeof parseThinkingTurnLayout>['segments']): string[] {
  return segments.map((segment) => {
    if (segment.kind === 'phase-text') {
      return `PHASE:${segment.text.slice(0, 12)}`;
    }
    const tools = segment.timeline.filter((item) => item.type === 'tool').map((item) => item.name);
    return `GROUP[${tools.join('+')}]`;
  });
}

describe('STO express chronology', () => {
  it('keeps phase text in commit order when messages are well-formed', () => {
    const labels = segmentLabels(parseThinkingTurnLayout(STO_EXPRESS_MESSAGES, { isLiveStream: false }).segments);
    expect(labels).toEqual([
      'PHASE:我来帮你分析申通快递近半',
      'GROUP[dws]',
      'PHASE:我需要先获取申通快递近半',
      'GROUP[exec]',
      'PHASE:我需要获取申通快递的单量',
      'GROUP[exec]',
    ]);
  });

  it('preserves order when Claude fragments thinking → text → tool across messages', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我来帮你分析申通快递近半年的单量数据并生成报告。' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '思考A' },
          { type: 'tool_use', id: 't1', name: 'dws', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '我需要先获取申通快递近半年的单量数据。让我使用 dws 工具来查询相关数据。',
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '思考C' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '我需要获取申通快递的单量数据。让我先检查可用的数据源。',
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't2', name: 'exec', input: {} }],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    console.log('segments detail', live.segments.map((s) =>
      s.kind === 'phase-text'
        ? { kind: 'phase', key: s.key, text: s.text.slice(0, 30) }
        : { kind: 'group', state: s.state, inter: s.interBatchText?.slice(0, 30) },
    ));

    expect(live.segments.map((s) =>
      s.kind === 'phase-text' ? `P:${s.key}:${s.text.slice(0, 15)}` : `G:${s.state}`,
    )).toMatchInlineSnapshot(`
      [
        "G:completed",
        "P:phase-text-opening:我来帮你分析申通快递近半年的单",
        "P:phase-text-after-0:我需要先获取申通快递近半年的单",
        "P:phase-text-after-1-mid-0:我需要获取申通快递的单量数据。",
        "G:active",
      ]
    `);
  });

  it('keeps live-stream narration in thinking panel after first tool group', () => {
    const committed = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我来帮你分析申通快递近半年的单量数据并生成报告。' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '思考A' },
          { type: 'tool_use', id: 't1', name: 'dws', input: {} },
        ],
      },
    ];
    const streamMessage = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '我需要先获取申通快递近半年的单量数据。让我使用 dws 工具来查询相关数据。',
        },
      ],
    };

    const live = parseThinkingTurnLayout([...committed, streamMessage], { isLiveStream: true });
    const labels = segmentLabels(live.segments);

    expect(labels).toEqual([
      'PHASE:我来帮你分析申通快递近半',
      'GROUP[dws]',
      'PHASE:我需要先获取申通快递近半',
    ]);
    expect(live.finalReplyText).toBeNull();
  });

  it.each(['claude', 'openclaw'] as const)(
    'keeps a supplemental live tool after the committed tool group for %s',
    (engineProfile) => {
      const messages = [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '加载数据' },
            { type: 'tool_use', id: 'skill-1', name: 'Skill', input: { skill: 'finance' } },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '数据已拿到。现在生成 HTML 报告。' }],
        },
      ];

      const live = parseThinkingTurnLayout(messages, {
        isLiveStream: true,
        engineProfile,
        streamingTools: [
          {
            id: 'write-1',
            name: 'Write',
            status: 'running',
            input: '{"file_path":"report.html","content":"<html>',
          },
        ],
      });

      expect(segmentLabels(live.segments)).toEqual([
        'GROUP[Skill]',
        'PHASE:数据已拿到。现在生成 H',
        'GROUP[Write]',
      ]);
    },
  );
});
