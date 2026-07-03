/**
 * Workflow execution record persisted to OpenClaw session .jsonl transcripts.
 * Survives app reinstall (localStorage cleared) when session files remain on disk.
 */

export type WorkflowSessionRecordPhase = 'started' | 'completed' | 'failed';

export interface WorkflowExecutionSessionRecord {
  type: 'workflow_execution_record';
  success: boolean;
  domain: 'workflow';
  data: {
    phase: WorkflowSessionRecordPhase;
    sessionKey: string;
    templateId: string;
    templateName: string;
    workflowId: string;
    runId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'unknown';
    paramsSummary?: string;
    collectedInputs?: Record<string, unknown>;
    completedAt?: string;
  };
}

export function buildWorkflowExecutionSessionRecord(
  input: Omit<WorkflowExecutionSessionRecord['data'], never> & {
    phase: WorkflowSessionRecordPhase;
  },
): WorkflowExecutionSessionRecord {
  return {
    type: 'workflow_execution_record',
    success: input.phase !== 'failed',
    domain: 'workflow',
    data: input,
  };
}
