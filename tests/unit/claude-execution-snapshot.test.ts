import { describe, expect, it } from 'vitest';

import { mergeClaudeExecutionEntries, parseClaudeExecutionTurn } from '@electron/engines/claude-execution-snapshot';

function userMessage(content: unknown) {
  return { type: 'user', message: { role: 'user', content } };
}

function assistantMessage(content: unknown) {
  return { type: 'assistant', message: { role: 'assistant', content } };
}

describe('parseClaudeExecutionTurn', () => {
  it('merges archived and current transcript entries by id and timestamp', () => {
    const duplicate = { uuid: 'duplicate', timestamp: '2026-07-21T07:04:03.225Z', type: 'assistant' };
    const entries = mergeClaudeExecutionEntries([
      { sessionId: 'archived', entries: [duplicate, { uuid: 'older', timestamp: '2026-07-21T07:04:01.000Z' }] },
      { sessionId: 'current', entries: [duplicate, { uuid: 'newer', timestamp: '2026-07-21T07:04:05.000Z' }] },
    ], 10);

    expect(entries.map((entry) => entry.uuid)).toEqual(['older', 'duplicate', 'newer']);
  });

  it('merges raw tool_use and hidden tool_result without retaining successful output', () => {
    const command = "sai-cli policy volume-biznum query --params '{\"dateDimension\":\"DAY\"}'";
    const snapshot = parseClaudeExecutionTurn([
      userMessage('查询全国业务量'),
      assistantMessage([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command, description: '查询全国业务量' } }]),
      userMessage([{ type: 'tool_result', tool_use_id: 'toolu_1', content: JSON.stringify({ ok: true, data: { bizNum: '82434243.0000' } }), is_error: false }]),
      assistantMessage([{ type: 'text', text: '查询完成。' }]),
    ]);

    expect(snapshot?.tools).toEqual([{
      toolCallId: 'toolu_1',
      name: 'Bash',
      status: 'completed',
      command,
      description: '查询全国业务量',
      error: undefined,
    }]);
    expect(snapshot?.tools[0]).not.toHaveProperty('input');
    expect(snapshot?.tools[0]).not.toHaveProperty('summary');
    expect(JSON.stringify(snapshot)).not.toContain('82434243');
  });

  it('keeps sanitized error metadata from tool_result', () => {
    const snapshot = parseClaudeExecutionTurn([
      userMessage('查询全国业务量'),
      assistantMessage([{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'sai-cli policy volume query' } }]),
      userMessage([{ type: 'tool_result', tool_use_id: 'toolu_2', content: JSON.stringify({ ok: false, code: 'PARAM_INVALID', message: 'password=private-value 参数错误' }), is_error: true }]),
      assistantMessage('执行失败。'),
    ]);

    expect(snapshot?.tools[0]).toMatchObject({
      name: 'Bash',
      status: 'error',
      error: { code: 'PARAM_INVALID', message: 'password=[redacted] 参数错误' },
    });
    expect(JSON.stringify(snapshot)).not.toContain('private-value');
  });

  it('marks tool_use without a matching result as unknown', () => {
    const snapshot = parseClaudeExecutionTurn([
      userMessage('执行查询'),
      assistantMessage([{ type: 'tool_use', id: 'toolu_3', name: 'Bash', input: { command: 'sai-cli policy volume query' } }]),
      assistantMessage('暂未获取结果。'),
    ]);

    expect(snapshot?.tools[0].status).toBe('unknown');
  });
});
