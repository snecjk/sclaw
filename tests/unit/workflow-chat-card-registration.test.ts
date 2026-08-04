import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerChatWorkflowCard = vi.fn();
const refreshWorkflowChatCards = vi.fn();

vi.mock('@/lib/workflow-api', () => ({
  registerChatWorkflowCard: (...args: unknown[]) => registerChatWorkflowCard(...args),
}));

vi.mock('@/stores/workflow-chat-cards', () => ({
  refreshWorkflowChatCards: (...args: unknown[]) => refreshWorkflowChatCards(...args),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      currentSessionKey: 'session-1',
    }),
  },
}));

vi.mock('@/stores/chat/display-selectors', () => ({
  getSessionDisplayMessages: () => [
    { id: 'user-anchor', role: 'user', content: '启动工作流' },
  ],
}));

vi.mock('@/stores/chat/runtime-v2-store', () => ({
  useChatRuntimeV2Store: {
    getState: () => ({ sessionsByKey: {} }),
  },
}));

import {
  attachMissingWorkflowChatCardAnchors,
  registerStartedWorkflowChatCard,
} from '@/lib/workflow-chat-card-registration';

describe('registerStartedWorkflowChatCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers against the latest user message and refreshes session refs', async () => {
    registerChatWorkflowCard.mockResolvedValue(true);

    await expect(registerStartedWorkflowChatCard({
      runId: 'run-1',
      sessionKey: 'session-1',
      title: '天气工作流',
    })).resolves.toBe(true);

    expect(registerChatWorkflowCard).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      sessionKey: 'session-1',
      anchorUserMessageId: 'user-anchor',
    }));
    expect(refreshWorkflowChatCards).toHaveBeenCalledWith('session-1');
  });

  it('does not cache a card reference when Main cannot register the wf_run row', async () => {
    registerChatWorkflowCard.mockResolvedValue(false);

    await expect(registerStartedWorkflowChatCard({
      runId: 'run-race',
      sessionKey: 'session-1',
      title: '天气工作流',
    })).resolves.toBe(false);
    expect(registerChatWorkflowCard).toHaveBeenCalledTimes(1);
    expect(refreshWorkflowChatCards).not.toHaveBeenCalled();
  });

  it('enriches a standalone card with the latest durable user message before the run', async () => {
    registerChatWorkflowCard.mockResolvedValue(true);

    await attachMissingWorkflowChatCardAnchors({
      sessionKey: 'session-1',
      messages: [
        { id: 'user-before', role: 'user', content: '启动', timestamp: 1 },
        { id: 'assistant', role: 'assistant', content: '处理中', timestamp: 2 },
        { id: 'user-after', role: 'user', content: '后来问题', timestamp: 4 },
      ],
      cards: [{
        runId: 'run-standalone',
        sessionKey: 'session-1',
        anchorUserMessageId: null,
        title: '天气工作流',
        startedAt: '1970-01-01T00:00:03.000Z',
      }],
    });

    expect(registerChatWorkflowCard).toHaveBeenCalledWith(expect.objectContaining({
      anchorUserMessageId: 'user-before',
    }));
    expect(refreshWorkflowChatCards).toHaveBeenCalledTimes(1);
  });
});
