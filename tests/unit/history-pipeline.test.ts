import { describe, expect, it } from 'vitest';
import {
  mergeHistoryDisplayMessages,
  prepareHistoryMessages,
} from '@/stores/chat/history-pipeline';
import type { RawMessage } from '@/stores/chat/types';

describe('history-pipeline', () => {
  it('keeps raw tool results but filters them from display history', () => {
    const rawMessages: RawMessage[] = [
      { id: 'user-1', role: 'user', content: 'make chart', timestamp: 1 },
      { id: 'tool-1', role: 'toolresult', content: 'tool output', timestamp: 2 },
      { id: 'assistant-1', role: 'assistant', content: 'done', timestamp: 3 },
    ];

    const prepared = prepareHistoryMessages({
      rawMessages,
      currentMessages: [],
      sessionKey: 'agent:main:main',
    });

    expect(prepared.rawMessages).toHaveLength(3);
    expect(prepared.filteredMessages.map((message) => message.id)).toEqual(['user-1', 'assistant-1']);
    expect(prepared.enrichedMessages.map((message) => message.id)).toEqual(['user-1', 'assistant-1']);
  });

  it('dedupes redundant user messages while preserving assistant replies', () => {
    const messages: RawMessage[] = [
      { id: 'user-1', role: 'user', content: 'hello', timestamp: 1 },
      { id: 'user-echo', role: 'user', content: 'hello', timestamp: 1.1 },
      { id: 'assistant-1', role: 'assistant', content: 'hi', timestamp: 2 },
    ];

    const merged = mergeHistoryDisplayMessages({
      messages,
      currentMessages: [],
      sessionKey: 'agent:main:main',
      sessionLabels: {},
      userMessageAt: 1000,
      getMessageText: (content) => String(content ?? ''),
    });

    expect(merged.map((message) => message.id)).toEqual(['user-1', 'assistant-1']);
  });

  it('does not copy synthetic parameter forms from the current display into history', () => {
    const loaded: RawMessage[] = [
      { id: 'user-1', role: 'user', content: '创建工作流', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: '请确认参数', timestamp: 2 },
    ];
    const current: RawMessage[] = [
      loaded[0],
      {
        ...loaded[1],
        content: [
          { type: 'text', text: '请确认参数' },
          {
            type: 'parameter_form',
            formId: 'workflow:tpl-1',
            formConfig: { fields: [] },
            formContext: { source: 'workflow', sourceId: 'tpl-1' },
          },
        ],
      },
    ];

    const merged = mergeHistoryDisplayMessages({
      messages: loaded,
      currentMessages: current,
      sessionKey: 'agent:main:main',
      sessionLabels: {},
      userMessageAt: 1_000,
      getMessageText: (content) => String(content ?? ''),
    });

    expect(merged[1].content).toBe('请确认参数');
  });

  it('does not synthesize a session-label user when optimistic overlay already covers the send', () => {
    const merged = mergeHistoryDisplayMessages({
      messages: [],
      currentMessages: [],
      sessionKey: 'agent:main:session-1',
      sessionLabels: { 'agent:main:session-1': '帮我做报价测算：覆盖新客测算与老客调价' },
      userMessageAt: 1_000,
      sending: false,
      optimisticUser: {
        id: 'optimistic-1',
        role: 'user',
        content: '帮我做报价测算：覆盖新客测算与老客调价，并给出调价建议。',
        _skillMeta: { slug: 'customer-monitor', title: '客户异常监控' },
      },
      getMessageText: (content) => String(content ?? ''),
    });

    expect(merged).toEqual([]);
  });
});
