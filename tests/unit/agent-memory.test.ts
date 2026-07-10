import { describe, expect, it } from 'vitest';

import {
  appendAgentMemoryContext,
  buildAgentMemoryContextText,
  coerceMemoryMessageText,
  findLatestUserMessageBeforeAssistant,
  stripAgentMemoryContextForDisplay,
} from '@/lib/agent-memory';

describe('agent-memory helpers', () => {
  it('strips injected memory context for display', () => {
    const withContext = appendAgentMemoryContext('原始问题', [
      { memory: '用户偏好中文回答', score: 0.98 },
    ]);

    expect(withContext).toContain('StoClaw-Agent-Memory');
    expect(stripAgentMemoryContextForDisplay(withContext)).toBe('原始问题');
  });

  it('formats memory context with ranked items', () => {
    const text = buildAgentMemoryContextText([
      { memory: '用户喜欢简洁输出', score: 0.91 },
      { memory: '用户偏好先给结论再展开' },
    ]);

    expect(text).toContain('1. [score=0.910] 用户喜欢简洁输出');
    expect(text).toContain('2. 用户偏好先给结论再展开');
  });

  it('extracts plain text blocks from content arrays', () => {
    expect(coerceMemoryMessageText([
      { type: 'thinking', thinking: '忽略这个' },
      { type: 'text', text: '第一段' },
      { type: 'text', text: '第二段' },
    ])).toBe('第一段 第二段');
  });

  it('finds the latest user message before an assistant reply', () => {
    const text = findLatestUserMessageBeforeAssistant([
      { role: 'user', id: 'u1', content: '第一问' },
      { role: 'assistant', id: 'a1', content: '中间回复' },
      { role: 'user', id: 'u2', content: [{ type: 'text', text: '最终问题' }] },
      { role: 'assistant', id: 'a2', content: '最终回复' },
    ], 'a2');

    expect(text).toBe('最终问题');
  });
});
