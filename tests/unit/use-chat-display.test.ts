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

  it('anchors a follow-up send to the latest user instead of the previous assistant turn', () => {
    mockLastUserMessageAt = 4_000;
    const followUp: RawMessage = {
      id: 'u2',
      role: 'user',
      content: '明天全天都可以的',
      timestamp: 4_000,
    };

    const { result } = renderHook(() => useChatDisplay({
      messages: [...assistantTurnMessages, followUp],
      sending: true,
      pendingFinal: false,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingTools: [{ id: 'tool-follow-up', name: 'search', status: 'running' }],
    }));

    expect(result.current.activeTurn?.turnStableKey).toBe('turn-user-u2');
    expect(result.current.activeTurn?.precedingUserMessage).toBe(followUp);
    expect(result.current.activeTurn?.turnMessages).toEqual([]);
    expect(result.current.staticItems.some((item) => (
      item.type === 'single'
        ? item.message.id === 'a1'
        : item.messages.some((message) => message.id === 'a1')
    ))).toBe(true);
  });

  it('sets isProcessing when pendingFinal and only completed streaming tools remain', () => {
    mockLastUserMessageAt = 900;

    const { result } = renderHook(() => useChatDisplay({
      messages: assistantTurnMessages,
      sending: true,
      pendingFinal: true,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingTools: [{ id: 'tool-1', name: 'exec', status: 'completed' }],
    }));

    expect(result.current.activeTurn?.activeStream.isProcessing).toBe(true);
  });
});
