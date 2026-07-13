import { describe, expect, it } from 'vitest';
import {
  extractWorkflowExecutionsFromHistory,
  shouldSkipWorkflowSchemaAbsorb,
} from '@/lib/workflow-history-recovery';
import type { RawMessage } from '@/stores/chat';

function toolResultMessage(envelope: Record<string, unknown>): RawMessage {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    timestamp: Date.now() / 1000,
  };
}

describe('workflow history recovery', () => {
  it('extracts workflow_execution_record from raw history', () => {
    const raw: RawMessage[] = [
      toolResultMessage({
        type: 'workflow_execution_record',
        success: true,
        domain: 'workflow',
        data: {
          phase: 'started',
          sessionKey: 'agent:main:session-1',
          templateId: 'tpl_00000002',
          templateName: '客户异常监控',
          workflowId: 'wf_abc',
          runId: 'run_123',
          status: 'running',
          paramsSummary: '数据来源：系统预置',
        },
      }),
    ];

    const hints = extractWorkflowExecutionsFromHistory(raw);
    expect(hints).toHaveLength(1);
    expect(hints[0].runId).toBe('run_123');
    expect(hints[0].templateId).toBe('tpl_00000002');
    expect(hints[0].source).toBe('execution_record');
  });

  it('skips schema absorb when execution_record exists in jsonl', () => {
    const raw: RawMessage[] = [
      toolResultMessage({
        type: 'workflow_schema_ready',
        success: true,
        domain: 'workflow',
        data: { templateId: 'tpl_00000002', schemaHash: 'h1', schema: { fields: [], steps: [] } },
      }),
      toolResultMessage({
        type: 'workflow_execution_record',
        success: true,
        domain: 'workflow',
        data: {
          phase: 'started',
          sessionKey: 'agent:main:session-1',
          templateId: 'tpl_00000002',
          templateName: '客户异常监控',
          workflowId: 'wf_abc',
          runId: 'run_123',
          status: 'running',
        },
      }),
    ];

    expect(shouldSkipWorkflowSchemaAbsorb(raw, 'agent:main:session-1')).toBe(true);
  });

  it('extracts workflow_execution_started from gateway tool results', () => {
    const raw: RawMessage[] = [
      toolResultMessage({
        type: 'workflow_execution_started',
        success: true,
        domain: 'workflow',
        data: {
          workflowId: 'wf_xyz',
          runId: 'run_456',
          status: 'running',
          templateName: '定时任务',
        },
      }),
    ];

    const hints = extractWorkflowExecutionsFromHistory(raw);
    expect(hints[0].runId).toBe('run_456');
    expect(hints[0].source).toBe('execution_started');
  });
});
