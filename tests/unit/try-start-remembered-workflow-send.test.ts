import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tryStartRememberedWorkflowSend } from '@/hooks/use-workflow-send';
import { useChatStore } from '@/stores/chat';

const SESSION_KEY = 'agent:test:main';

function resetChat() {
  useChatStore.setState({
    messages: [],
    currentSessionKey: SESSION_KEY,
    currentAgentId: 'test',
    pendingWorkflow: null,
  });
}

describe('tryStartRememberedWorkflowSend', () => {
  beforeEach(() => {
    resetChat();
    localStorage.removeItem('stoclaw:workflow-executions');
  });

  it('does not intercept bare re-execution when session has no workflow memory', async () => {
    const sendMessage = vi.fn();
    const handled = await tryStartRememberedWorkflowSend({
      text: '重新执行',
      context: { sessionKey: SESSION_KEY, agentId: 'test' },
      sendMessage,
    });

    expect(handled).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it('does not intercept explicit workflow start without memory', async () => {
    const sendMessage = vi.fn();
    for (const text of ['运行这个工作流', '运行这个工作流 / 执行工作流', '执行工作流']) {
      resetChat();
      const handled = await tryStartRememberedWorkflowSend({
        text,
        context: { sessionKey: SESSION_KEY, agentId: 'test' },
        sendMessage,
      });

      expect(handled, text).toBe(false);
      expect(useChatStore.getState().messages).toHaveLength(0);
    }
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not intercept analytical workflow discussion without memory', async () => {
    const sendMessage = vi.fn();
    const handled = await tryStartRememberedWorkflowSend({
      text: '分析一下工作流的执行情况',
      context: { sessionKey: SESSION_KEY, agentId: 'test' },
      sendMessage,
    });

    expect(handled).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });
});
