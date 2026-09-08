import { describe, expect, it } from 'vitest';
import {
  AGENT_EXECUTION_MEMORY_CONTEXT_MARKER,
  AGENT_MEMORY_CONTEXT_MARKER,
  buildAgentMemoryContextBlocks,
  prependAgentMemoryBlock,
} from '../../shared/agent-memory-prompt';
import { sanitizeMemoryFromChatPayload, stripAgentMemoryContexts } from '../../shared/agent-memory-display';

describe('shared agent-memory helpers', () => {
  it('builds ranked preference and active execution blocks', () => {
    const blocks = buildAgentMemoryContextBlocks({ results: [
      { id: 'p1', memory: '用户喜欢简洁输出', score: 0.91, metadata: {} },
      { id: 'e1', memory: '执行 sai-cli 查询', score: 0.532, metadata: { memoryScope: 'execution', status: 'active', confidence: 0.8 } },
      { id: 'e2', memory: '过期经验', score: 1, metadata: { memoryScope: 'execution', status: 'inactive' } },
    ] });
    expect(blocks.preference).toContain('1. 用户喜欢简洁输出');
    expect(blocks.execution).toContain('1. 执行 sai-cli 查询');
    expect(blocks.preference).not.toContain('[score=');
    expect(blocks.execution).not.toContain('[score=');
    expect(blocks.preference).toContain('已经编排好的工作流，必须忽略整个记忆块');
    expect(blocks.execution).toContain('必须完全忽略下面的历史执行经验');
    expect(blocks.execution).toContain('不得用记忆增加、删除、替换、重排或绕过任何步骤');
    expect(blocks.execution).toContain('不得根据历史经验改选工具、技能或工作流');
    expect(blocks.preference).toContain('先仅依据当前用户请求匹配适用技能');
    expect(`${blocks.preference}\n${blocks.execution}`.match(/技能规则优先（强制）：/g)).toHaveLength(1);
    expect(`${blocks.preference}\n${blocks.execution}`).toContain('必须先完整读取并遵守 SKILL.md');
    expect(`${blocks.preference}\n${blocks.execution}`).toContain('记忆不能替代技能规则');
    expect(blocks.execution).not.toContain('过期经验');
    expect(blocks.injectedExecutionMemories).toEqual([{ memoryId: 'e1', memory: '执行 sai-cli 查询' }]);
  });

  it('exposes renderer-safe memory text without internal prompt guardrails', () => {
    const blocks = buildAgentMemoryContextBlocks({ results: [
      { id: 'p1', memory: '用户喜欢简洁输出', score: 0.91, metadata: {} },
      { id: 'e1', memory: '执行 sai-cli 查询', score: 0.8, metadata: { memoryScope: 'execution', status: 'active' } },
    ] });

    expect(blocks.displayMemories).toEqual([
      { kind: 'preference', memory: '用户喜欢简洁输出' },
      { kind: 'execution', memory: '执行 sai-cli 查询' },
    ]);
    expect(JSON.stringify(blocks.displayMemories)).not.toContain('技能规则优先');
    expect(JSON.stringify(blocks.displayMemories)).not.toContain('StoClaw-Agent-Memory');
  });

  it('keeps skill priority guardrails when only execution memory is injected', () => {
    const blocks = buildAgentMemoryContextBlocks({ results: [
      { id: 'e1', memory: '历史执行路径', score: 0.8, metadata: { memoryScope: 'execution', status: 'active' } },
    ] });
    expect(blocks.preference).toBeUndefined();
    expect(blocks.execution).toContain('技能规则优先（强制）：');
  });

  it('can place memory before the current request so the request remains the final matching signal', () => {
    const block = `${AGENT_EXECUTION_MEMORY_CONTEXT_MARKER}\n历史工具路径\n${AGENT_EXECUTION_MEMORY_CONTEXT_MARKER}`;
    const message = prependAgentMemoryBlock('当前用户请求', block, AGENT_EXECUTION_MEMORY_CONTEXT_MARKER);
    expect(message).toBe(`${block}\n\n当前用户请求`);
    expect(prependAgentMemoryBlock(message, block, AGENT_EXECUTION_MEMORY_CONTEXT_MARKER)).toBe(message);
  });

  it('strips memory blocks from nested renderer payloads without mutating the source', () => {
    let message = prependAgentMemoryBlock('原始问题', `${AGENT_EXECUTION_MEMORY_CONTEXT_MARKER}\n经验\n${AGENT_EXECUTION_MEMORY_CONTEXT_MARKER}`, AGENT_EXECUTION_MEMORY_CONTEXT_MARKER);
    message = prependAgentMemoryBlock(message, `${AGENT_MEMORY_CONTEXT_MARKER}\n偏好\n${AGENT_MEMORY_CONTEXT_MARKER}`, AGENT_MEMORY_CONTEXT_MARKER);
    const source = { result: { messages: [{ role: 'user', content: [{ type: 'text', text: message }] }] } };
    const sanitized = sanitizeMemoryFromChatPayload(source);
    expect(sanitized.result.messages[0].content[0].text).toBe('原始问题');
    expect(source.result.messages[0].content[0].text).toContain('偏好');
    expect(stripAgentMemoryContexts(message)).toBe('原始问题');
  });
});
