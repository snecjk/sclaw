import { beforeEach, describe, expect, it, vi } from 'vitest';

const createChatCompletionStreamMock = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/agent-memory-remote-service', () => ({
  agentMemoryRemoteService: {
    createChatCompletionStream: (...args: unknown[]) => createChatCompletionStreamMock(...args),
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
    createChatCompletionStreamMock.mockResolvedValue(
      JSON.stringify({ shouldStore: true, intent: '查询经营数据' }),
    );
  });

  it('summarizes with the fixed Memory Center model and chat completion API', async () => {
    const service = new ClaudeExecutionSummaryService();
    const result = await service.summarize({
      agentId: 'main',
      userTask: '查询今日经营数据',
    });

    expect(createChatCompletionStreamMock).toHaveBeenCalledOnce();
    expect(createChatCompletionStreamMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen3.6-plus',
      messages: [
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user' }),
      ],
      response_format: { type: 'json_object' },
    }));
    expect(result).toMatchObject({ shouldStore: true, intent: '查询经营数据' });
  });

  it('emits valid JSON example punctuation when candidate assessments are requested', async () => {
    const service = new ClaudeExecutionSummaryService();
    await service.summarize({
      userTask: '查询今日经营数据',
      injectedExperiences: [{ memoryId: 'memory-1', memory: '旧经验' }],
    });

    const request = createChatCompletionStreamMock.mock.calls[0]?.[0] as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const prompt = request.messages?.find((message) => message.role === 'user')?.content;
    expect(prompt).toContain('"confidence": 0.7,\n  "candidateAssessments"');
  });
});
