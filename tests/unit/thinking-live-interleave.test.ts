import { describe, expect, it } from 'vitest';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';

function segmentKinds(segments: ReturnType<typeof parseThinkingTurnLayout>['segments']): string[] {
  return segments.map((segment) => segment.kind);
}

describe('live OpenClaw phase-text interleaving', () => {
  it('does not stack mid-turn narrations after all tool groups when texts trail tools in one snapshot', () => {
    const narrations = [
      '我需要先了解业务指标数据从哪里获取。',
      '让我搜索一下是否有相关的模板或技能。',
      '找到了数据目录，接下来查询最新一周指标。',
    ];
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '查配置' },
          { type: 'tool_use', id: 't0', name: 'read', input: {} },
          { type: 'thinking', thinking: '搜模板' },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
          { type: 'thinking', thinking: '查数据' },
          { type: 'tool_use', id: 't2', name: 'sai-cli', input: {} },
          { type: 'text', text: narrations[0] },
          { type: 'text', text: narrations[1] },
          { type: 'text', text: narrations[2] },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    expect(segmentKinds(live.segments)).toEqual([
      'tool-group',
      'phase-text',
      'tool-group',
      'phase-text',
      'tool-group',
      'phase-text',
    ]);
  });

  it('rebuilds live layout when streaming snapshots merge think/tool first and narrations arrive later', () => {
    const narrations = [
      '我需要先了解业务指标数据从哪里获取。',
      '让我搜索一下是否有相关的模板或技能。',
      '找到了数据目录，接下来查询最新一周指标。',
    ];
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '查配置' },
          { type: 'tool_use', id: 't0', name: 'read', input: {} },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '查配置' },
          { type: 'tool_use', id: 't0', name: 'read', input: {} },
          { type: 'thinking', thinking: '搜模板' },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
          { type: 'text', text: narrations[0] },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '查配置' },
          { type: 'tool_use', id: 't0', name: 'read', input: {} },
          { type: 'thinking', thinking: '搜模板' },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
          { type: 'text', text: narrations[0] },
          { type: 'thinking', thinking: '查数据' },
          { type: 'tool_use', id: 't2', name: 'sai-cli', input: {} },
          { type: 'text', text: narrations[1] },
        ],
      },
    ];

    const live = parseThinkingTurnLayout(messages, { isLiveStream: true });
    const kinds = segmentKinds(live.segments);
    expect(kinds.filter((kind) => kind === 'tool-group').length).toBeGreaterThanOrEqual(2);
    expect(kinds.filter((kind) => kind === 'phase-text').length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < kinds.length - 1; i += 1) {
      expect(kinds[i]).not.toBe(kinds[i + 1]);
    }
  });

  it('zips stacked tool-groups with trailing narrations during live OpenClaw stream', () => {
    const narrations = [
      '发现只返回了 3 天预报，我去获取完整 7 天数据。',
      '好的，已获取天气数据。我需要阅读 sto-distinctive-design 的 SKILL.md。',
      '现在我要读取黄金范例和组件库。',
      '好的，我已理解规范。接下来生成报告。',
      '我将遵循 STO 设计规范创建此报告。',
    ];
    const makeBatch = (toolId: string, thinking: string) => [
      { type: 'thinking' as const, thinking },
      { type: 'tool_use' as const, id: toolId, name: 'read', input: {} },
    ];

    let cumulative: Array<Record<string, unknown>> = [];
    const messages: Array<{ role: string; content: Array<Record<string, unknown>> }> = [];
    for (let index = 0; index < 5; index += 1) {
      cumulative = [...cumulative, ...makeBatch(`t${index}`, `步骤 ${index + 1}`)];
      messages.push({ role: 'assistant', content: [...cumulative] });
    }
    for (let index = 0; index < narrations.length; index += 1) {
      cumulative = [...cumulative, { type: 'text', text: narrations[index] }];
      messages.push({ role: 'assistant', content: [...cumulative] });
    }

    const live = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      engineProfile: 'openclaw',
    });
    const kinds = segmentKinds(live.segments);
    expect(kinds.filter((kind) => kind === 'tool-group')).toHaveLength(5);
    expect(kinds.filter((kind) => kind === 'phase-text')).toHaveLength(5);
    for (let index = 0; index < kinds.length - 1; index += 1) {
      expect(kinds[index]).not.toBe(kinds[index + 1]);
    }
    expect(live.segments[0]?.kind).toBe('tool-group');
    expect(live.segments[1]?.kind).toBe('phase-text');
    if (live.segments[1]?.kind === 'phase-text') {
      expect(live.segments[1].text).toBe(narrations[0]);
    }
  });
});
