import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores/chat';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import { sendImmediately, useMessageQueueStore } from '@/stores/message-queue';

const TARGET = 'agent:writer:queued';
const originalChatState = useChatStore.getState();

function setRunningTarget(): void {
  const session = createClientSessionState();
  session.runtime = {
    phase: 'running', runId: 'run-old', idempotencyKey: 'message-old', engineType: 'openclaw',
    epoch: 1, sequence: 1, startedAt: 1, lastEventAt: 1,
  };
  useChatRuntimeV2Store.setState({ sessionsByKey: { [TARGET]: session } });
}

describe('message queue delivery targeting', () => {
  beforeEach(() => {
    useMessageQueueStore.getState().clearAll();
  });

  afterEach(() => {
    useChatStore.setState({
      currentSessionKey: originalChatState.currentSessionKey,
      currentAgentId: originalChatState.currentAgentId,
      abortRun: originalChatState.abortRun,
      sendMessage: originalChatState.sendMessage,
    });
    useChatRuntimeV2Store.setState({ sessionsByKey: {} });
    useMessageQueueStore.getState().clearAll();
  });

  it('keeps the queued item when the active run cannot be aborted', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentSessionKey: 'agent:main:visible',
      abortRun: vi.fn().mockResolvedValue(false),
      sendMessage,
    });
    setRunningTarget();
    useMessageQueueStore.getState().enqueue(TARGET, 'queued text');
    const item = useMessageQueueStore.getState().getQueue(TARGET)[0];

    await expect(sendImmediately(TARGET, item.id)).resolves.toBe(false);

    expect(useMessageQueueStore.getState().getQueue(TARGET)).toHaveLength(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('delivers the selected item to its explicit session after abort succeeds', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentSessionKey: 'agent:main:visible',
      abortRun: vi.fn().mockResolvedValue(true),
      sendMessage,
    });
    setRunningTarget();
    useMessageQueueStore.getState().enqueue(TARGET, 'queued text');
    const item = useMessageQueueStore.getState().getQueue(TARGET)[0];

    await expect(sendImmediately(TARGET, item.id)).resolves.toBe(true);

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'queued text',
      sessionKey: TARGET,
    }));
    expect(useMessageQueueStore.getState().getQueue(TARGET)).toHaveLength(0);
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:visible');
  });
});
