import { describe, it, expect } from 'vitest';
import {
  assistantMessageHasVisibleReplyBody,
  findLastUserMessageIndex,
  findTurnDisplayAssistantMessage,
  isCurrentUserTurnIncomplete,
  isLastAssistantInUserTurn,
  isLastUserMessage,
  isMessageInCurrentUserTurn,
  isTurnDisplayAssistantMessage,
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

  it('uses last text reply as display assistant when skill turn has trailing tool-only snapshots', () => {
    const reply: RawMessage = {
      id: 'a_text',
      role: 'assistant',
      content: '一口价 HTML 报告已生成',
    };
    const toolOnly: RawMessage = {
      id: 'a_tool',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu1', name: 'write_file', input: {} }],
    };
    const messages = [userMsg, reply, toolOnly];

    expect(assistantMessageHasVisibleReplyBody(reply)).toBe(true);
    expect(assistantMessageHasVisibleReplyBody(toolOnly)).toBe(false);
    expect(findTurnDisplayAssistantMessage(messages, 0)).toBe(reply);
    expect(isTurnDisplayAssistantMessage(reply, messages)).toBe(true);
    expect(isTurnDisplayAssistantMessage(toolOnly, messages)).toBe(false);
  });

  it('treats trailing workflow_card-only assistant as non-blocking for display reply', () => {
    const reply: RawMessage = {
      id: 'a_text',
      role: 'assistant',
      content: '报告已生成',
    };
    const cardOnly: RawMessage = {
      id: 'a_card',
      role: 'assistant',
      content: [{ type: 'workflow_card', runId: 'run_abc', templateName: 'test' }],
    };
    const messages = [userMsg, reply, cardOnly];

    expect(isTurnDisplayAssistantMessage(reply, messages)).toBe(true);
    expect(findTurnDisplayAssistantMessage(messages, 0)).toBe(reply);
  });

  it('does not block meta when runId appears only in prose without workflow card', () => {
    const prose: RawMessage = {
      id: 'a_prose',
      role: 'assistant',
      content: '参考 run_ghost 已处理完毕',
    };
    expect(
      isCurrentUserTurnIncomplete({
        sessionMessages: [userMsg, prose],
        sending: false,
        lastUserMessageAt: null,
        workflowCardStates: {},
        hasPendingWorkflowSchema: false,
      }),
    ).toBe(false);
  });
});
