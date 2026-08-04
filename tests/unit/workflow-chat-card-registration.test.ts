import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerChatWorkflowCard = vi.fn();
const refreshWorkflowChatCards = vi.fn();

vi.mock('@/lib/workflow-api', () => ({
  registerChatWorkflowCard: (...args: unknown[]) => registerChatWorkflowCard(...args),
}));

vi.mock('@/stores/workflow-chat-cards', () => ({
  refreshWorkflowChatCards: (...args: unknown[]) => refreshWorkflowChatCards(...args),
}));

import { attachMissingWorkflowChatCardAnchors } from '@/lib/workflow-chat-card-registration';

describe('workflow chat card anchor repair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
