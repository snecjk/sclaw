import type { WorkflowExecutionResult, WorkflowRunStatus } from '@/types/workflow';
import type { WorkflowRunArtifact, WorkflowRunResponse } from '@/types/workflow';

/** Map Agent Workflow API status values to UI status. */
export function normalizeWorkflowRunStatus(status: string | undefined | null): WorkflowRunStatus {
  switch (status) {
    case 'succeeded':
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'failed';
    case 'running':
      return 'running';
    case 'pending':
      return 'pending';
    case 'timeout':
      return 'timeout';
    default:
      return 'unknown';
  }
}

export function normalizeWorkflowStepStatus(status: string): 'pending' | 'running' | 'completed' | 'failed' {
  switch (status) {
    case 'succeeded':
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    default:
      return 'pending';
  }
}

export function isActiveWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return status === 'pending' || status === 'running';
}

export function isTerminalWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'timeout';
}

function mapArtifacts(artifacts: WorkflowRunArtifact[]) {
  return artifacts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    url: a.url,
    size: a.size,
  }));
}

/** Extract client-facing result summary + artifacts from GET /runs response. */
export function extractRunResult(run: WorkflowRunResponse): WorkflowExecutionResult | undefined {
  const normalized = normalizeWorkflowRunStatus(run.status);
  const artifacts = mapArtifacts(run.artifacts ?? []);

  const clientResult = run.result;
  if (clientResult?.summary || clientResult?.title) {
    return {
      summary: clientResult.summary ?? clientResult.title ?? undefined,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };
  }

  if (normalized !== 'completed') {
    return artifacts.length > 0 ? { artifacts } : undefined;
  }

  if (typeof run.output === 'string' && run.output.trim()) {
    return { summary: run.output, artifacts: artifacts.length > 0 ? artifacts : undefined };
  }

  return artifacts.length > 0 ? { artifacts } : undefined;
}
