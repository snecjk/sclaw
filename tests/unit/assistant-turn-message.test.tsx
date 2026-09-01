import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

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

  it('renders agent preparation progress in the compact process area instead of reply text', () => {
    const userMessage = {
      id: 'user-2',
      role: 'user' as const,
      content: '帮我生成一份表格',
      timestamp: 3_000,
    };

    const { rerender } = render(
      <AssistantTurnMessage
        turnMessages={[]}
        sessionMessages={[userMessage]}
        precedingUserMessage={userMessage}
        turnStableKey="turn-user-user-2"
        showThinking={false}
        activeStream={{
          streamMessage: {
            id: 'skill-routing-run-2',
            role: 'assistant',
            content: [{ type: 'text', text: '正在匹配技能…' }],
            metadata: { kind: 'skill-routing-progress', status: 'completed' },
          },
          streamText: '正在匹配技能…',
          streamingTools: [],
          streamingMessages: [{
            id: 'agent-preparation-memory-user-2',
            role: 'assistant',
            content: [{ type: 'text', text: '已检索到相关记忆' }],
            metadata: {
              kind: 'agent-preparation-progress',
              stage: 'memory',
              status: 'completed',
              memories: [
                { kind: 'preference', memory: '用户偏好简洁回答' },
                { kind: 'execution', memory: '天气查询使用 wttr.in JSON 接口' },
              ],
            },
          }],
          streamingToolResults: [],
          isRunActive: true,
          isConnecting: false,
          isProcessing: false,
        }}
      />,
    );

    expect(screen.getByRole('region', { name: 'Preparation' })).toBeInTheDocument();
    expect(screen.getByText('Skill matching')).toBeInTheDocument();
    expect(screen.getByText('正在匹配技能…')).toBeInTheDocument();
    expect(screen.getByText('Memory retrieval')).toBeInTheDocument();
    expect(screen.getByText('已检索到相关记忆')).toBeInTheDocument();
    expect(screen.getByText('用户偏好简洁回答')).toBeInTheDocument();
    expect(screen.getByText('天气查询使用 wttr.in JSON 接口')).toBeInTheDocument();
    expect(screen.getByText('Preference')).toBeInTheDocument();
    expect(screen.getByText('Experience')).toBeInTheDocument();
    expect(screen.queryByText('匹配中')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-reply')).not.toBeInTheDocument();
    const memoryToggle = screen.getByRole('button', { name: 'Memory retrieval' });
    const skillToggle = screen.getByRole('button', { name: 'Skill matching' });
    expect(memoryToggle).toHaveAttribute('aria-expanded', 'false');
    expect(skillToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(memoryToggle);
    expect(memoryToggle).toHaveAttribute('aria-expanded', 'true');
    const preparationStages = screen.getAllByRole('status');
    expect(preparationStages[0]).toHaveAttribute('data-agent-preparation-status', 'memory');
    expect(preparationStages[1]).toHaveAttribute('data-agent-preparation-status', 'skill');

    const finalMessage = {
      id: 'assistant-2',
      role: 'assistant' as const,
      content: '我可以帮你生成表格。',
      timestamp: 4_000,
    };
    rerender(
      <AssistantTurnMessage
        turnMessages={[finalMessage]}
        sessionMessages={[userMessage, finalMessage]}
        precedingUserMessage={userMessage}
        turnStableKey="turn-user-user-2"
        showThinking={false}
      />,
    );

    expect(screen.queryByRole('region', { name: 'Preparation' })).not.toBeInTheDocument();
    expect(screen.getByText('我可以帮你生成表格。')).toBeInTheDocument();
  });

});
