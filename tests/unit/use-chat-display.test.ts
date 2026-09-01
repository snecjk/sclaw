import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RawMessage } from '@/stores/chat/types';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';

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
  it('promotes the last assistant turn into activeTurn for user-initiated sends', () => {
    const { result } = renderHook(() => useChatDisplay({
      messages: assistantTurnMessages,
      sending: true,
      pendingFinal: true,
      transcriptPending: true,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingTools: [{ id: 'tool-2', name: 'search', status: 'running' }],
      turnAnchorAt: 900,
    }));

    expect(result.current.staticItems.length).toBe(1);
    expect(result.current.activeTurn?.turnMessages.length).toBeGreaterThan(0);
    expect(result.current.staticItems.some((item) => item.type === 'assistant-turn')).toBe(false);
  });

  it('keeps cron/background sends as a fresh activeTurn without promoting prior static turn', () => {
    const { result } = renderHook(() => useChatDisplay({
      messages: [
        { id: 'u1', role: 'user', content: 'scheduled task', timestamp: 1_000 },
        { id: 'a1', role: 'assistant', content: 'partial answer', timestamp: 2_000 },
      ],
      sending: true,
      pendingFinal: true,
      transcriptPending: true,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingTools: [{ id: 'tool-2', name: 'search', status: 'running' }],
      turnAnchorAt: null,
    }));

    expect(result.current.staticItems.some(
      (item) => item.type === 'single' && item.message.id === 'a1',
    )).toBe(true);
    expect(result.current.activeTurn?.turnMessages).toEqual([]);
    expect(result.current.activeTurn?.turnStableKey).toBe('active-turn');
  });

  it('anchors a follow-up send to the latest user instead of the previous assistant turn', () => {
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
      transcriptPending: false,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingTools: [{ id: 'tool-follow-up', name: 'search', status: 'running' }],
      turnAnchorAt: 4_000,
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
    const { result } = renderHook(() => useChatDisplay({
      messages: assistantTurnMessages,
      sending: true,
      pendingFinal: true,
      transcriptPending: true,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingTools: [{ id: 'tool-1', name: 'exec', status: 'completed' }],
      turnAnchorAt: 900,
    }));

    expect(result.current.activeTurn?.activeStream.isProcessing).toBe(true);
  });

  it('restores the connecting hint after preparation completes and before model output starts', () => {
    const userMessage: RawMessage = {
      id: 'u-preparation', role: 'user', content: '你能做啥', timestamp: 1_000,
    };
    const base = {
      messages: [userMessage],
      sending: true,
      pendingFinal: false,
      transcriptPending: false,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: null,
      streamText: '',
      streamingToolResults: [],
      streamingTools: [],
      turnAnchorAt: 1_000,
    };
    const memoryProgress = (status: 'running' | 'completed'): RawMessage => ({
      id: 'agent-preparation-memory-u-preparation',
      role: 'assistant',
      content: status === 'running' ? '正在检索相关记忆…' : '已检索到相关记忆',
      metadata: { kind: 'agent-preparation-progress', stage: 'memory', status },
    });

    const { result, rerender } = renderHook(
      ({ status }: { status: 'running' | 'completed' }) => useChatDisplay({
        ...base,
        streamingMessages: [memoryProgress(status)],
      }),
      { initialProps: { status: 'running' as const } },
    );

    expect(result.current.activeTurn?.activeStream.isConnecting).toBe(false);

    rerender({ status: 'completed' });
    expect(result.current.activeTurn?.activeStream.isConnecting).toBe(true);

    const withFirstReply = renderHook(() => useChatDisplay({
      ...base,
      streamMsg: { id: 'assistant-first', role: 'assistant', content: '我可以' },
      streamText: '我可以',
      streamingMessages: [memoryProgress('completed')],
    }));
    expect(withFirstReply.result.current.activeTurn?.activeStream.isConnecting).toBe(false);
  });

  it('keeps a completed final overlay visible until transcript takeover', () => {
    const userMessage: RawMessage = {
      id: 'u-final', role: 'user', content: 'who are you', timestamp: 1_000,
    };
    const { result } = renderHook(() => useChatDisplay({
      messages: [userMessage],
      sending: false,
      pendingFinal: false,
      transcriptPending: true,
      showThinking: true,
      lastChatEventAt: Date.now(),
      streamMsg: {
        id: 'a-final', role: 'assistant', content: 'final answer', timestamp: 2_000,
      },
      streamText: 'final answer',
      streamingMessages: [],
      streamingToolResults: [],
      streamingTools: [],
      turnAnchorAt: 1_000,
    }));

    expect(result.current.shouldRenderStreaming).toBe(true);
    expect(result.current.activeTurn?.turnStableKey).toBe('turn-user-u-final');
    expect(result.current.activeTurn?.precedingUserMessage).toBe(userMessage);
    expect(result.current.activeTurn?.activeStream.streamText).toBe('final answer');
    expect(result.current.activeTurn?.activeStream.isRunActive).toBe(false);
  });
});
