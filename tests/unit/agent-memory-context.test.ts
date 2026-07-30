import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { initializeMock, reinitializeAfterAuthChangeMock, searchMemoriesMock } = vi.hoisted(() => ({
  initializeMock: vi.fn(),
  reinitializeAfterAuthChangeMock: vi.fn(),
  searchMemoriesMock: vi.fn(),
}));

vi.mock('../../electron/services/agent-memory-orchestrator', () => ({
  agentMemoryOrchestrator: {
    initialize: (...args: unknown[]) => initializeMock(...args),
    reinitializeAfterAuthChange: (...args: unknown[]) => reinitializeAfterAuthChangeMock(...args),
    searchMemories: (...args: unknown[]) => searchMemoriesMock(...args),
  },
}));

import {
  AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS,
  AGENT_MEMORY_MIN_RELEVANCE_SCORE,
  AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS,
  AGENT_MEMORY_SEARCH_TOP_K,
  AgentMemoryContextService,
} from '../../electron/services/agent-memory-context-service';

describe('AgentMemoryContextService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initializeMock.mockReset().mockResolvedValue({ bootstrap: { enabled: true, userId: 'user-1' } });
    reinitializeAfterAuthChangeMock.mockReset().mockResolvedValue({ bootstrap: { enabled: true, userId: 'user-1' } });
    searchMemoriesMock.mockReset().mockResolvedValue({ results: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fails open when initialization exceeds its own budget', async () => {
    initializeMock.mockImplementation(() => new Promise(() => undefined));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = new AgentMemoryContextService().prepare('请查询最近一周的订单情况');
    await vi.advanceTimersByTimeAsync(AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS);
    await expect(result).resolves.toEqual({ injectedExecutionMemories: [] });
    expect(initializeMock).toHaveBeenCalledWith();
    expect(searchMemoriesMock).not.toHaveBeenCalled();
  });

  it('keeps the timed-out initialization alive and reuses it on the next request', async () => {
    let resolveInitialization!: (value: { bootstrap: { enabled: boolean; userId: string } }) => void;
    initializeMock.mockImplementation(() => new Promise((resolve) => {
      resolveInitialization = resolve;
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new AgentMemoryContextService();

    const firstResult = service.prepare('请查询最近一周的订单情况');
    await vi.advanceTimersByTimeAsync(AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS);
    await expect(firstResult).resolves.toEqual({ injectedExecutionMemories: [] });

    resolveInitialization({ bootstrap: { enabled: true, userId: 'user-1' } });
    await vi.runAllTicks();
    await expect(service.prepare('请继续查询订单情况')).resolves.toEqual({ injectedExecutionMemories: [] });
    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(searchMemoriesMock).toHaveBeenCalledTimes(1);
  });

  it('shares initialization between startup warmup and the first request', async () => {
    let resolveInitialization!: (value: { bootstrap: { enabled: boolean; userId: string } }) => void;
    initializeMock.mockImplementation(() => new Promise((resolve) => {
      resolveInitialization = resolve;
    }));
    const service = new AgentMemoryContextService();

    service.warmup();
    const result = service.prepare('请查询最近一周的订单情况');
    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(initializeMock).toHaveBeenCalledWith();

    resolveInitialization({ bootstrap: { enabled: true, userId: 'user-1' } });
    await expect(result).resolves.toEqual({ injectedExecutionMemories: [] });
    expect(searchMemoriesMock).toHaveBeenCalledTimes(1);
  });

  it('reuses an active successful startup initialization after login', async () => {
    let resolveInitialization!: (value: { bootstrap: { enabled: boolean; userId: string } }) => void;
    initializeMock.mockImplementation(() => new Promise((resolve) => {
      resolveInitialization = resolve;
    }));
    const service = new AgentMemoryContextService();

    service.warmup();
    const loginInitialization = service.reinitializeAfterLogin();
    resolveInitialization({ bootstrap: { enabled: true, userId: 'user-1' } });

    await expect(loginInitialization).resolves.toMatchObject({ bootstrap: { enabled: true } });
    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(reinitializeAfterAuthChangeMock).not.toHaveBeenCalled();
  });

  it('reinitializes once after login when startup returned without an enabled bootstrap', async () => {
    initializeMock.mockResolvedValue({ ready: false, bootstrap: { enabled: false, userId: '' } });
    const service = new AgentMemoryContextService();

    service.warmup();
    await vi.runAllTicks();
    const first = service.reinitializeAfterLogin();
    const second = service.reinitializeAfterLogin();

    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ bootstrap: { enabled: true } });
    expect(reinitializeAfterAuthChangeMock).toHaveBeenCalledTimes(1);
  });

  it('gives retrieval a fresh timeout budget', async () => {
    initializeMock.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ bootstrap: { enabled: true, userId: 'user-1' } }), AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS - 100);
    }));
    searchMemoriesMock.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ results: [] }), AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS - 100);
    }));
    const result = new AgentMemoryContextService().prepare('请查询最近一周的订单情况');
    await vi.advanceTimersByTimeAsync(AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS + AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS - 200);
    await expect(result).resolves.toEqual({ injectedExecutionMemories: [] });
  });

  it('uses the trusted bootstrap user and builds both memory blocks', async () => {
    searchMemoriesMock.mockResolvedValue({ results: [
      { id: 'pref-1', memory: '用户偏好简洁回答', score: 0.9, metadata: {} },
      { id: 'exec-1', memory: '先查询再汇总', score: 0.8, metadata: { memoryScope: 'execution', status: 'active', confidence: 0.9 } },
    ] });
    const result = await new AgentMemoryContextService().prepare('请查询最近一周的订单情况');
    expect(searchMemoriesMock).toHaveBeenCalledWith('请查询最近一周的订单情况', {
      userId: 'user-1',
      topK: AGENT_MEMORY_SEARCH_TOP_K,
    });
    expect(result.preference).toContain('用户偏好简洁回答');
    expect(result.execution).toContain('先查询再汇总');
    expect(result.injectedExecutionMemories).toEqual([{ memoryId: 'exec-1', memory: '先查询再汇总' }]);
  });

  it('does not inject weak memory matches that could override current tool routing', async () => {
    searchMemoriesMock.mockResolvedValue({ results: [
      {
        id: 'exec-weak',
        memory: '改用历史工具查询',
        score: AGENT_MEMORY_MIN_RELEVANCE_SCORE - 0.01,
        metadata: { memoryScope: 'execution', status: 'active', confidence: 0.9 },
      },
      {
        id: 'exec-relevant',
        memory: '校验当前查询参数',
        score: AGENT_MEMORY_MIN_RELEVANCE_SCORE,
        metadata: { memoryScope: 'execution', status: 'active', confidence: 0.9 },
      },
    ] });

    const result = await new AgentMemoryContextService().prepare('请使用当前技能查询订单');

    expect(result.execution).not.toContain('改用历史工具查询');
    expect(result.execution).toContain('校验当前查询参数');
    expect(result.injectedExecutionMemories).toEqual([
      { memoryId: 'exec-relevant', memory: '校验当前查询参数' },
    ]);
  });
});
