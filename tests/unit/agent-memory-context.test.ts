import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeIpcMock, resolveAgentMemoryUserIdMock } = vi.hoisted(() => ({
  invokeIpcMock: vi.fn(),
  resolveAgentMemoryUserIdMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/agent-memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-memory')>();
  return {
    ...actual,
    resolveAgentMemoryUserId: () => resolveAgentMemoryUserIdMock(),
  };
});

import {
  AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS,
  AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS,
  buildAgentMemoryContextBlocks,
} from '@/lib/agent-memory-context';

describe('buildAgentMemoryContextBlocks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeIpcMock.mockReset();
    resolveAgentMemoryUserIdMock.mockReset();
    resolveAgentMemoryUserIdMock.mockResolvedValue('user-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('falls back to empty memory when retrieval exceeds the send budget', async () => {
    invokeIpcMock.mockImplementation(() => new Promise(() => undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const resultPromise = buildAgentMemoryContextBlocks('请查询最近一周的订单情况');
    await vi.advanceTimersByTimeAsync(AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS);

    await expect(resultPromise).resolves.toEqual({ injectedExecutionMemories: [] });
    expect(warn).toHaveBeenCalledWith(
      '[agent-memory] context blocks retrieval failed:',
      expect.objectContaining({ name: 'AgentMemoryRetrievalTimeoutError' }),
    );
  });

  it('does not start mem0 search when initialization exceeds its own budget', async () => {
    let finishInitialization: ((userId: string) => void) | undefined;
    resolveAgentMemoryUserIdMock.mockImplementation(() => new Promise<string>((resolve) => {
      finishInitialization = resolve;
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const resultPromise = buildAgentMemoryContextBlocks('请查询最近一周的订单情况');
    await vi.advanceTimersByTimeAsync(AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS);

    await expect(resultPromise).resolves.toEqual({ injectedExecutionMemories: [] });
    finishInitialization?.('user-1');
    await Promise.resolve();
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });

  it('gives search a fresh budget after slow initialization', async () => {
    resolveAgentMemoryUserIdMock.mockImplementation(() => new Promise<string>((resolve) => {
      setTimeout(() => resolve('user-1'), AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS - 100);
    }));
    invokeIpcMock.mockImplementation(() => new Promise<unknown>((resolve) => {
      setTimeout(() => resolve([]), AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS - 100);
    }));

    const resultPromise = buildAgentMemoryContextBlocks('请查询最近一周的订单情况');
    await vi.advanceTimersByTimeAsync(
      AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS + AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS - 200,
    );

    await expect(resultPromise).resolves.toEqual({ injectedExecutionMemories: [] });
    expect(invokeIpcMock).toHaveBeenCalledTimes(1);
  });

  it('uses memory results that arrive within the send budget', async () => {
    invokeIpcMock.mockResolvedValue([]);

    await expect(buildAgentMemoryContextBlocks('请查询最近一周的订单情况'))
      .resolves.toEqual({ injectedExecutionMemories: [] });
    expect(invokeIpcMock).toHaveBeenCalledWith(
      'agent-memory:mem0-search',
      '请查询最近一周的订单情况',
      { userId: 'user-1', topK: 12 },
    );
  });
});
