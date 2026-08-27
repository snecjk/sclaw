import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: ({ message, isStreaming }: {
    message: { content: unknown };
    isStreaming?: boolean;
  }) => (
    <div data-testid="assistant-reply" data-streaming={String(Boolean(isStreaming))}>
      {String(message.content)}
    </div>
  ),
}));

vi.mock('@/pages/Chat/ThinkingProcessPanel', () => ({
  ThinkingTurnProcess: () => null,
}));

import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';

describe('AssistantTurnMessage retained final overlay', () => {
  it('keeps the final overlay body visible after the run becomes terminal', () => {
    const userMessage = {
      id: 'user-1',
      role: 'user' as const,
      content: '你是谁',
      timestamp: 1_000,
    };

    render(
      <AssistantTurnMessage
        turnMessages={[]}
        sessionMessages={[userMessage]}
        precedingUserMessage={userMessage}
        turnStableKey="turn-user-user-1"
        showThinking={false}
        activeStream={{
          streamMessage: {
            id: 'assistant-final',
            role: 'assistant',
            content: '我是最终回复',
            timestamp: 2_000,
          },
          streamText: '我是最终回复',
          streamingTools: [],
          streamingMessages: [],
          streamingToolResults: [],
          isRunActive: false,
          isConnecting: false,
          isProcessing: false,
        }}
      />,
    );

    const reply = screen.getByTestId('assistant-reply');
    expect(reply).toHaveTextContent('我是最终回复');
    expect(reply).toHaveAttribute('data-streaming', 'false');
  });
});
