import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RawMessage } from '@/stores/chat/types';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';

let mockLastUserMessageAt: number | null = null;

vi.mock('@/stores/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/chat')>();
  return {
    ...actual,
    useChatStore: (selector: (state: { lastUserMessageAt: number | null }) => unknown) =>
      selector({ lastUserMessageAt: mockLastUserMessageAt }),
  };
});

const assistantTurnMessages: RawMessage[] = [
  { id: 'u1', role: 'user', content: 'hello', timestamp: 1_000 },
  {
    id: 'a1',
    role: 'assistant',
    content: [{ type: 'thinking', thinking: 'working' }, { type: 'text', text: 'partial' }],
    timestamp: 2_000,
  },
  { id: 't1', role: 'toolResult', content: 'ok', timestamp: 3_000, toolCallId: 'tool-1' },
];

describe('useChatDisplay', () => {
  beforeEach(() => {
    mockLastUserMessageAt = null;
  });

  it('promotes the last assistant turn into activeTurn for user-initiated sends', () => {
    mockLastUserMessageAt = 900;

    const { result } = renderHook(() => useChatDisplay({
      messages: assistantTurnMessages,
      sending: true,
      pendingFinal: true,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingTools: [{ id: 'tool-2', name: 'search', status: 'running' }],
    }));

    expect(result.current.staticItems.length).toBe(1);
    expect(result.current.activeTurn?.turnMessages.length).toBeGreaterThan(0);
    expect(result.current.staticItems.some((item) => item.type === 'assistant-turn')).toBe(false);
  });

  it('keeps cron/background sends as a fresh activeTurn without promoting prior static turn', () => {
    mockLastUserMessageAt = null;

    const { result } = renderHook(() => useChatDisplay({
      messages: [
        { id: 'u1', role: 'user', content: 'scheduled task', timestamp: 1_000 },
        { id: 'a1', role: 'assistant', content: 'partial answer', timestamp: 2_000 },
      ],
      sending: true,
      pendingFinal: true,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingTools: [{ id: 'tool-2', name: 'search', status: 'running' }],
    }));

    expect(result.current.staticItems.some(
      (item) => item.type === 'single' && item.message.id === 'a1',
    )).toBe(true);
    expect(result.current.activeTurn?.turnMessages).toEqual([]);
  });
});
