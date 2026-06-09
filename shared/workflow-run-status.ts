import type {
  WorkflowExecutionResult,
  WorkflowExecutionState,
  WorkflowRunArtifact,
  WorkflowRunNodeRun,
  WorkflowRunStatus,
} from '../src/types/workflow';

/** Raw GET /runs payload — fields may be omitted while run is starting or on older backends. */
export interface WorkflowRunApiPayload {
  id: string;
  workflowId: string;
  status?: string | null;
  startedAt?: string;
  completedAt?: string | null;
  nodeRuns?: WorkflowRunNodeRun[] | null;
  artifacts?: Array<Partial<WorkflowRunArtifact> & { uri?: string; kind?: string; tempUrl?: string }> | null;
  output?: unknown;
  result?: { title?: string | null; summary?: string | null; status?: string | null } | null;
  error?: string | null;
}

/** Map Agent Workflow API status values to UI status. */
export function normalizeWorkflowRunStatus(status: string | undefined | null): WorkflowRunStatus {
  switch (status?.toLowerCase()) {
    case 'succeed':
    case 'succeeded':
    case 'success':
    case 'completed':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'cancelled':
    case 'canceled':
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

/** Resolve run status from top-level, nested result, and completion hints. */
export function resolveWorkflowRunStatus(run: WorkflowRunApiPayload): WorkflowRunStatus {
  const top = normalizeWorkflowRunStatus(run.status);
  if (top !== 'unknown') return top;

  const outputStatus =
    typeof run.output === 'object' && run.output !== null && 'status' in run.output
      ? normalizeWorkflowRunStatus(String((run.output as { status?: string }).status))
      : 'unknown';
  if (outputStatus !== 'unknown') return outputStatus;

  const fromResult = normalizeWorkflowRunStatus(run.result?.status);
  if (fromResult !== 'unknown') return fromResult;

  if (run.error?.trim()) return 'failed';
  if (run.completedAt) return 'completed';

  return 'unknown';
}

export function normalizeWorkflowStepStatus(status: string): 'pending' | 'running' | 'completed' | 'failed' {
  switch (status?.toLowerCase()) {
    case 'succeed':
    case 'succeeded':
    case 'success':
    case 'completed':
      return 'completed';
    case 'failed':
    case 'error':
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

export function normalizeRunArtifacts(
  artifacts: WorkflowRunApiPayload['artifacts'],
): WorkflowRunArtifact[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((a) => ({
      id: a.id ?? '',
      name: a.name ?? a.kind ?? 'artifact',
      type: a.type ?? a.kind ?? 'file',
      url: a.url ?? a.uri ?? a.tempUrl ?? '',
      size: a.size,
    }))
    .filter((a) => a.id || a.url);
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

function extractOutputSummary(output: unknown): string | undefined {
  if (typeof output === 'string' && output.trim()) return output.trim();
  if (typeof output !== 'object' || output === null) return undefined;
  const record = output as Record<string, unknown>;
  const summary = record.summary;
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  if (typeof summary === 'object' && summary !== null) {
    const text = (summary as { text?: string; title?: string }).text
      ?? (summary as { text?: string; title?: string }).title;
    if (text?.trim()) return text.trim();
  }
  const data = record.data;
  if (typeof data === 'object' && data !== null) {
    const message = (data as { message?: string }).message;
    if (message?.trim()) return message.trim();
  }
  return undefined;
}

function collectArtifactsFromOutput(output: unknown): WorkflowRunArtifact[] {
  if (typeof output !== 'object' || output === null) return [];
  const raw = (output as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(raw)) return [];
  return normalizeRunArtifacts(raw as WorkflowRunApiPayload['artifacts']);
}

/** Map GET /runs `data` to UI execution state (null-safe for Main + Renderer). */
export function workflowRunResponseToExecutionState(run: WorkflowRunApiPayload): WorkflowExecutionState {
  const nodeRuns = run.nodeRuns ?? [];
  const status = resolveWorkflowRunStatus(run);
  const totalNodes = nodeRuns.length || 1;
  const completedNodes = nodeRuns.filter(
    (n) => normalizeWorkflowStepStatus(n.status) === 'completed',
  ).length;
  const progress = status === 'completed' ? 100 : Math.min(99, Math.floor((completedNodes / totalNodes) * 100));
  const topArtifacts = normalizeRunArtifacts(run.artifacts);
  const outputArtifacts = collectArtifactsFromOutput(run.output);
  const artifacts = topArtifacts.length > 0 ? topArtifacts : outputArtifacts;

  return {
    runId: run.id,
    workflowId: run.workflowId,
    status,
    progress,
    currentStep: nodeRuns.find((n) => normalizeWorkflowStepStatus(n.status) === 'running')?.nodeId,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? undefined,
    steps: nodeRuns.map((n) => ({
      name: n.nodeId,
      status: normalizeWorkflowStepStatus(n.status),
      duration: n.startedAt && n.completedAt
        ? new Date(n.completedAt).getTime() - new Date(n.startedAt).getTime()
        : undefined,
      error: n.error,
    })),
    result: extractRunResultFromPayload(run, status, artifacts),
    error: run.error ?? undefined,
  };
}

function extractRunResultFromPayload(
  run: WorkflowRunApiPayload,
  status: WorkflowRunStatus,
  artifacts: WorkflowRunArtifact[],
): WorkflowExecutionResult | undefined {
  const mapped = mapArtifacts(artifacts);
  const outputSummary = extractOutputSummary(run.output);

  if (run.result?.summary || run.result?.title) {
    return {
      summary: run.result.summary ?? run.result.title ?? outputSummary ?? undefined,
      artifacts: mapped.length > 0 ? mapped : undefined,
    };
  }

  if (outputSummary) {
    return { summary: outputSummary, artifacts: mapped.length > 0 ? mapped : undefined };
  }

  if (status !== 'completed') {
    return mapped.length > 0 ? { artifacts: mapped } : undefined;
  }

  return mapped.length > 0 ? { artifacts: mapped } : undefined;
}

/** Extract client-facing result summary + artifacts from GET /runs response. */
export function extractRunResult(run: WorkflowRunApiPayload): WorkflowExecutionResult | undefined {
  const status = resolveWorkflowRunStatus(run);
  const topArtifacts = normalizeRunArtifacts(run.artifacts);
  const outputArtifacts = collectArtifactsFromOutput(run.output);
  const artifacts = topArtifacts.length > 0 ? topArtifacts : outputArtifacts;
  return extractRunResultFromPayload(run, status, artifacts);
}
