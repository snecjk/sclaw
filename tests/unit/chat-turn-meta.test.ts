import { describe, it, expect } from 'vitest';
import {
  findLastUserMessageIndex,
  isCurrentUserTurnIncomplete,
  isLastAssistantInUserTurn,
  isLastUserMessage,
  isMessageInCurrentUserTurn,
} from '@/pages/Chat/chat-turn-meta';
import type { RawMessage } from '@/stores/chat';

describe('chat-turn-meta', () => {
  const userMsg: RawMessage = { id: 'u1', role: 'user', content: 'start workflow' };
  const assistantMsg: RawMessage = {
    id: 'a1',
    role: 'assistant',
    content: [{ type: 'workflow_card', runId: 'run_abc', templateName: 'test' }],
  };

  it('detects last user message', () => {
    const messages = [userMsg, assistantMsg];
    expect(isLastUserMessage(userMsg, messages)).toBe(true);
    expect(isLastUserMessage(assistantMsg, messages)).toBe(false);
    expect(findLastUserMessageIndex(messages)).toBe(0);
  });

  it('treats active workflow run as incomplete turn', () => {
    expect(
      isCurrentUserTurnIncomplete({
        sessionMessages: [userMsg, assistantMsg],
        sending: false,
        lastUserMessageAt: null,
        workflowCardStates: { run_abc: { status: 'pending' } },
        hasPendingWorkflowSchema: false,
      }),
    ).toBe(true);
  });

  it('treats terminal workflow run as complete turn', () => {
    expect(
      isCurrentUserTurnIncomplete({
        sessionMessages: [userMsg, assistantMsg],
        sending: false,
        lastUserMessageAt: null,
        workflowCardStates: { run_abc: { status: 'completed' } },
        hasPendingWorkflowSchema: false,
      }),
    ).toBe(false);
  });

  it('treats sending as incomplete turn', () => {
    expect(
      isCurrentUserTurnIncomplete({
        sessionMessages: [userMsg],
        sending: true,
        lastUserMessageAt: null,
        workflowCardStates: {},
        hasPendingWorkflowSchema: false,
      }),
    ).toBe(true);
  });

  it('marks last assistant in each user turn, not only the final turn', () => {
    const user2: RawMessage = { id: 'u2', role: 'user', content: 'again' };
    const assistant2: RawMessage = { id: 'a2', role: 'assistant', content: 'ok' };
    const user3: RawMessage = { id: 'u3', role: 'user', content: 'more' };
    const messages = [userMsg, assistantMsg, user2, assistant2, user3];

    expect(isLastAssistantInUserTurn(assistantMsg, messages)).toBe(true);
    expect(isLastAssistantInUserTurn(assistant2, messages)).toBe(true);
    expect(isMessageInCurrentUserTurn(assistantMsg, messages)).toBe(false);
    expect(isMessageInCurrentUserTurn(assistant2, messages)).toBe(false);
  });
});
