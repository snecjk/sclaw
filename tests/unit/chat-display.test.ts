import { describe, expect, it } from 'vitest';
import {
  isRedundantThinking,
  mergeThinkingTimelines,
} from '../../src/pages/Chat/chat-display';

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
});

describe('isRedundantThinking', () => {
  it('detects minor rewording with same intent prefix', () => {
    const a = '用户要求发送明天上海的天气给文鹏，我需要先调用天气技能获取数据。';
    const b = '用户要求发送明天上海的天气，我需要先调用天气技能获取数据，然后使用钉钉格式发送给文鹏。';
    expect(isRedundantThinking(a, b)).toBe(true);
  });
});
