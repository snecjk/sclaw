import { describe, expect, it } from 'vitest';
import {
  AGENT_EXECUTION_MEMORY_CONTEXT_MARKER,
  AGENT_MEMORY_CONTEXT_MARKER,
  appendAgentMemoryBlock,
  buildAgentMemoryContextBlocks,
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
    expect(blocks.execution).not.toContain('过期经验');
    expect(blocks.injectedExecutionMemories).toEqual([{ memoryId: 'e1', memory: '执行 sai-cli 查询' }]);
  });

  it('strips memory blocks from nested renderer payloads without mutating the source', () => {
    let message = appendAgentMemoryBlock('原始问题', `${AGENT_MEMORY_CONTEXT_MARKER}\n偏好\n${AGENT_MEMORY_CONTEXT_MARKER}`, AGENT_MEMORY_CONTEXT_MARKER);
    message = appendAgentMemoryBlock(message, `${AGENT_EXECUTION_MEMORY_CONTEXT_MARKER}\n经验\n${AGENT_EXECUTION_MEMORY_CONTEXT_MARKER}`, AGENT_EXECUTION_MEMORY_CONTEXT_MARKER);
    const source = { result: { messages: [{ role: 'user', content: [{ type: 'text', text: message }] }] } };
    const sanitized = sanitizeMemoryFromChatPayload(source);
    expect(sanitized.result.messages[0].content[0].text).toBe('原始问题');
    expect(source.result.messages[0].content[0].text).toContain('偏好');
    expect(stripAgentMemoryContexts(message)).toBe('原始问题');
  });
});
