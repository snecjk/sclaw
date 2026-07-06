import { describe, expect, it } from 'vitest';
import {
  buildClaudeWorkflowSessionEntry,
  encodeClaudeProjectKey,
} from '../../electron/services/claude-workflow-session-writer';
import { buildWorkflowExecutionSessionRecord } from '../../shared/workflow-session-record';
import { parseStoToolEnvelope } from '@/lib/builtin-tool-envelope';

describe('claude workflow session writer', () => {
  it('buildClaudeWorkflowSessionEntry produces parseable workflow_execution_record', () => {
    const envelope = buildWorkflowExecutionSessionRecord({
      phase: 'completed',
      sessionKey: 'agent:main:abc',
      templateId: 'tpl_00000002',
      templateName: '客户异常监控',
      workflowId: 'wf_7f54d0ba',
      runId: 'run_123',
      status: 'completed',
      paramsSummary: '数据来源：系统预置',
    });

    const entry = buildClaudeWorkflowSessionEntry(
      'session-uuid-1',
      envelope,
      'sto_wf_tool123',
      1_700_000_000_000,
    );

    expect(entry.type).toBe('user');
    expect(entry.session_id).toBe('session-uuid-1');
    expect(entry.isSynthetic).toBe(true);
    expect(entry.message.content[0]?.type).toBe('tool_result');

    const text = entry.message.content[0]?.content[0]?.text;
    expect(text).toBeTruthy();
    const parsed = parseStoToolEnvelope(text);
    expect(parsed?.type).toBe('workflow_execution_record');
    expect(parsed?.domain).toBe('workflow');
    expect((parsed?.data as { runId?: string })?.runId).toBe('run_123');
  });

  it('encodeClaudeProjectKey normalizes Windows paths', () => {
    expect(encodeClaudeProjectKey('C:\\Users\\dev\\workspace\\proj')).toBe(
      '-C:-Users-dev-workspace-proj',
    );
    expect(encodeClaudeProjectKey('/Users/dev/workspace/proj')).toBe(
      '-Users-dev-workspace-proj',
    );
  });
});
