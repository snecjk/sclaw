import { describe, expect, it } from 'vitest';

import { parseOpenClawExecutionTurn } from '@electron/engines/openclaw-execution-snapshot';

function finalMessage() {
  return { role: 'assistant', content: '查询完成。' };
}

describe('parseOpenClawExecutionTurn', () => {
  it('merges camelCase toolCall and toolResult without retaining successful output', () => {
    const command = 'sai-cli help market customer-profit-loss search';
    const snapshot = parseOpenClawExecutionTurn([
      { role: 'user', content: '查询客户项目损益' },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call_1',
          name: 'exec',
          arguments: { command, pty: false },
        }],
      },
      {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'exec',
        content: [{ type: 'text', text: JSON.stringify({ ok: true, data: { confidentialValue: 82434243 } }) }],
        isError: false,
      },
      finalMessage(),
    ]);

    expect(snapshot?.tools).toEqual([{
      toolCallId: 'call_1',
      name: 'sai-cli.help.market',
      status: 'completed',
      command,
      description: undefined,
      input: { pty: false },
      error: undefined,
    }]);
    expect(snapshot?.tools[0]).not.toHaveProperty('summary');
    expect(JSON.stringify(snapshot)).not.toContain('82434243');
  });

  it('keeps only sanitized diagnostics for a failed result', () => {
    const snapshot = parseOpenClawExecutionTurn([
      { role: 'user', content: '查询业务量' },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call_2', name: 'exec', arguments: { command: 'sai-cli policy volume query' } }],
      },
      {
        role: 'toolResult',
        toolCallId: 'call_2',
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'token=top-secret 请重新登录' } }) }],
        isError: true,
      },
      finalMessage(),
    ]);

    expect(snapshot?.tools[0]).toMatchObject({
      status: 'error',
      error: { code: 'AUTH_REQUIRED', message: 'token=[redacted] 请重新登录' },
    });
    expect(JSON.stringify(snapshot)).not.toContain('top-secret');
  });

  it('marks an unmatched tool call as unknown', () => {
    const snapshot = parseOpenClawExecutionTurn([
      { role: 'user', content: '执行查询' },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call_3', name: 'exec', arguments: { command: 'sai-cli policy volume query' } }],
      },
      finalMessage(),
    ]);

    expect(snapshot?.tools[0].status).toBe('unknown');
    expect(snapshot?.tools[0]).not.toHaveProperty('input');
  });

  it('handles message-level toolCalls with embedded results', () => {
    const snapshot = parseOpenClawExecutionTurn([
      { role: 'user', content: '执行查询' },
      {
        role: 'assistant',
        content: '已完成',
        toolCalls: [{
          id: 'call_4',
          name: 'exec',
          arguments: { command: 'sai-cli policy volume query' },
          status: 'completed',
          result: { ok: true, data: { confidentialValue: 'secret-business-data' } },
        }],
      },
    ]);

    expect(snapshot?.tools).toHaveLength(1);
    expect(snapshot?.tools[0]).toMatchObject({ toolCallId: 'call_4', status: 'completed' });
    expect(JSON.stringify(snapshot)).not.toContain('secret-business-data');
  });
});
