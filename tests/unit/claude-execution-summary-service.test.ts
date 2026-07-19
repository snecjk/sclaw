import { beforeEach, describe, expect, it, vi } from 'vitest';

const createChatCompletionMock = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/agent-memory-remote-service', () => ({
  agentMemoryRemoteService: {
    createChatCompletion: (...args: unknown[]) => createChatCompletionMock(...args),
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ClaudeExecutionSummaryService } from '@electron/services/claude-execution-summary-service';

describe('ClaudeExecutionSummaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createChatCompletionMock.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({ shouldStore: true, intent: '查询经营数据' }),
        },
      }],
    });
  });

  it('summarizes with the fixed Memory Center model and chat completion API', async () => {
    const service = new ClaudeExecutionSummaryService();
    const result = await service.summarize({
      agentId: 'main',
      userTask: '查询今日经营数据',
    });

    expect(createChatCompletionMock).toHaveBeenCalledOnce();
    expect(createChatCompletionMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen3.6-plus',
      messages: [
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user' }),
      ],
      response_format: { type: 'json_object' },
    }));
    expect(result).toMatchObject({ shouldStore: true, intent: '查询经营数据' });
  });
});
