import { beforeEach, describe, expect, it, vi } from 'vitest';

const createChatCompletionMock = vi.hoisted(() => vi.fn());
const searchKeywordsMock = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/agent-memory-remote-service', () => ({
  agentMemoryRemoteService: {
    createChatCompletion: (...args: unknown[]) => createChatCompletionMock(...args),
    searchKeywords: (...args: unknown[]) => searchKeywordsMock(...args),
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

const factories = {
  EmbedderFactory: { create: vi.fn() },
  LLMFactory: { create: vi.fn() },
  VectorStoreFactory: { create: vi.fn() },
};
patchMem0Factories(factories);

describe('StoMemoryCenterLlmProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createChatCompletionMock.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });
  });

  it('uses qwen3.6-plus without resolving a login-synced model', async () => {
    const provider = factories.LLMFactory.create('sto_memory_center_llm', {});
    await provider.generateResponse([{ role: 'user', content: 'hello' }]);

    expect(createChatCompletionMock).toHaveBeenCalledWith({
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });
});

describe('StoMemoryCenterVectorStoreProvider keyword search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchKeywordsMock.mockResolvedValue({
      items: [{
        recordId: 'mem-1',
        score: 8.5,
        content: '申通快递电商商城后端项目',
        memoryType: 'preference',
        userId: '1200287',
        appId: 'sto-claw',
        metadata: { textLemmatized: '申通 快递 商城' },
      }],
      topK: 60,
      count: 1,
    });
  });

  it('maps raw ES BM25 results into mem0 VectorStore results', async () => {
    const provider = factories.VectorStoreFactory.create('sto_memory_center_vector', {
      collectionName: 'memories',
      cacheDir: 'C:/tmp/mem0-keyword-test',
    });
    const results = await provider.keywordSearch('申通快递商城', 60, {
      memoryTypes: ['preference'],
      agent_id: 'agent-1',
    });

    expect(searchKeywordsMock).toHaveBeenCalledWith({
      query: '申通快递商城',
      topK: 60,
      collectionName: 'memories',
      agentId: 'agent-1',
      runId: undefined,
      sessionId: undefined,
      memoryTypes: ['preference'],
    });
    expect(results).toEqual([expect.objectContaining({
      id: 'mem-1',
      score: 8.5,
      payload: expect.objectContaining({
        data: '申通快递电商商城后端项目',
        memoryScope: 'preference',
      }),
    })]);
  });
});
