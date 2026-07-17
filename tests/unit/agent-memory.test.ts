import { describe, expect, it, vi } from 'vitest';

const { invokeIpcMock } = vi.hoisted(() => ({ invokeIpcMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn().mockResolvedValue(undefined),
}));

import {
  appendAgentMemoryContextBlock,
  buildAgentMemoryContextText,
  coerceMemoryMessageText,
  findLatestUserMessageBeforeAssistant,
  stripAgentMemoryContextForDisplay,
} from '@/lib/agent-memory';
import {
  buildAgentExecutionMemoryContextText,
  captureAgentMemories,
  discardAgentMemoriesForAbnormalTurn,
  rememberInjectedExecutionMemories,
  stripAgentExecutionMemoryContextForDisplay,
} from '@/lib/agent-execution-memory';
import { stripAgentMemoryContextsForDisplay } from '@/lib/agent-memory-display';
import { normalizeUserMessageForDisplay } from '@/lib/user-message-display';

describe('agent-memory helpers', () => {
  it('strips injected memory context for display', () => {
    const withContext = appendAgentMemoryContextBlock('原始问题', buildAgentMemoryContextText([
      { memory: '用户偏好中文回答', score: 0.98 },
    ]));

    expect(withContext).toContain('StoClaw-Agent-Memory');
    expect(stripAgentMemoryContextForDisplay(withContext)).toBe('原始问题');
  });

  it('strips execution memory context from gateway user-message echoes', () => {
    const withContext = [
      '一周单量数据情况',
      buildAgentExecutionMemoryContextText([{ memory: '执行 sai-cli 查询', score: 0.532 }]),
    ].join('\n\n');

    expect(stripAgentExecutionMemoryContextForDisplay(withContext)).toBe('一周单量数据情况');
    expect(stripAgentMemoryContextsForDisplay(withContext)).toBe('一周单量数据情况');
    expect(normalizeUserMessageForDisplay(withContext)).toBe('一周单量数据情况');
  });

  it('formats memory context with ranked items', () => {
    const text = buildAgentMemoryContextText([
      { memory: '用户喜欢简洁输出', score: 0.91 },
      { memory: '用户偏好先给结论再展开' },
    ]);

    expect(text).toContain('1. [score=0.910] 用户喜欢简洁输出');
    expect(text).toContain('2. 用户偏好先给结论再展开');
  });

  it('extracts plain text blocks from content arrays', () => {
    expect(coerceMemoryMessageText([
      { type: 'thinking', thinking: '忽略这个' },
      { type: 'text', text: '第一段' },
      { type: 'text', text: '第二段' },
    ])).toBe('第一段 第二段');
  });

  it('finds the latest user message before an assistant reply', () => {
    const text = findLatestUserMessageBeforeAssistant([
      { role: 'user', id: 'u1', content: '第一问' },
      { role: 'assistant', id: 'a1', content: '中间回复' },
      { role: 'user', id: 'u2', content: [{ type: 'text', text: '最终问题' }] },
      { role: 'assistant', id: 'a2', content: '最终回复' },
    ], 'a2');

    expect(text).toBe('最终问题');
  });

  it('does not dispatch normal memory capture after an abnormal terminal event', () => {
    invokeIpcMock.mockReset();
    rememberInjectedExecutionMemories('agent:main:failed-run', [
      { memoryId: 'memory-1', memory: '历史执行经验' },
    ]);
    discardAgentMemoriesForAbnormalTurn({
      sessionKey: 'agent:main:failed-run',
      runId: 'run-failed',
      reason: 'failed',
    });

    captureAgentMemories({
      sessionKey: 'agent:main:failed-run',
      runId: 'run-failed',
      agentId: 'main',
      engineType: 'claude',
    });

    expect(invokeIpcMock).not.toHaveBeenCalled();
  });
});
