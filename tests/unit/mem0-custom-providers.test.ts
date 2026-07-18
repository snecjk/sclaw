import { beforeEach, describe, expect, it, vi } from 'vitest';

const createChatCompletionMock = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/agent-memory-remote-service', () => ({
  agentMemoryRemoteService: {
    createChatCompletion: (...args: unknown[]) => createChatCompletionMock(...args),
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { patchMem0Factories } from '@electron/services/mem0-custom-providers';

describe('StoMemoryCenterLlmProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createChatCompletionMock.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });
  });

  it('uses qwen3.6-plus without resolving a login-synced model', async () => {
    const factories = {
      EmbedderFactory: { create: vi.fn() },
      LLMFactory: { create: vi.fn() },
      VectorStoreFactory: { create: vi.fn() },
    };
    patchMem0Factories(factories);

    const provider = factories.LLMFactory.create('sto_memory_center_llm', {});
    await provider.generateResponse([{ role: 'user', content: 'hello' }]);

    expect(createChatCompletionMock).toHaveBeenCalledWith({
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });
});
