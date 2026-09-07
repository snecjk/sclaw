import { describe, expect, it } from 'vitest';
import type { ChatDisplayItem } from '@/pages/Chat/chat-display';
import {
  buildChatTurnNavigationEntries,
  toChatNavigationExcerpt,
} from '@/components/chat/chat-turn-navigation';

describe('chat turn navigation', () => {
  it('pairs visible user prompts with their assistant replies and targets the user row', () => {
    const user = { id: 'u-1', role: 'user' as const, content: '请总结本周项目进展' };
    const items: ChatDisplayItem[] = [
      { type: 'single', key: 'user-row', message: user },
      {
        type: 'assistant-turn',
        key: 'turn-u-1',
        precedingUserMessage: user,
        toolResults: [],
        messages: [
          { role: 'assistant', content: '我先整理数据。' },
          { role: 'assistant', content: '本周已完成接口联调和回归测试。' },
        ],
      },
    ];

    expect(buildChatTurnNavigationEntries(items)).toEqual([
      expect.objectContaining({
        targetItemKey: 'user-row',
        prompt: '请总结本周项目进展',
        reply: '本周已完成接口联调和回归测试。',
        position: 0,
      }),
    ]);
  });

  it('excludes non-user rows and keeps a pending user turn without a reply', () => {
    const items: ChatDisplayItem[] = [
      { type: 'single', key: 'system', message: { role: 'system', content: 'hidden context' } },
      { type: 'workflow-run', key: 'workflow', card: { runId: 'run-1', title: 'Workflow', startedAt: '2026-01-01T00:00:00Z' } },
      { type: 'single', key: 'user-row', message: { id: 'u-1', role: 'user', content: '继续执行' } },
    ];

    expect(buildChatTurnNavigationEntries(items)).toEqual([
      expect.objectContaining({ targetItemKey: 'user-row', prompt: '继续执行', reply: '' }),
    ]);
  });

  it('normalizes whitespace and truncates preview text deterministically', () => {
    expect(toChatNavigationExcerpt('  第一行\n\n第二行  ', 20)).toBe('第一行 第二行');
    expect(toChatNavigationExcerpt('123456789', 6)).toBe('12345…');
  });
});
