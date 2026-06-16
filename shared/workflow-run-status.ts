import type {
  WorkflowExecutionResult,
  WorkflowExecutionState,
  WorkflowRunArtifact,
  WorkflowRunNodeRun,
  WorkflowRunStatus,
} from '../src/types/workflow';
import { normalizeWorkflowTimestamp, parseWorkflowTimestampMs } from './workflow-timestamp';

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

function isHttpArtifactUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export function normalizeRunArtifacts(
  artifacts: WorkflowRunApiPayload['artifacts'],
): WorkflowRunArtifact[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((a) => {
      const contentType = (a as { contentType?: string }).contentType;
      return {
        id: a.id ?? '',
        name: a.name ?? a.kind ?? 'artifact',
        type: a.type ?? a.kind ?? contentType ?? 'file',
        url: a.tempUrl ?? a.url ?? a.uri ?? '',
        size: a.size,
      };
    })
    .filter((a) => a.id || a.url);
}

function collectArtifactsFromNodeRuns(
  nodeRuns: WorkflowRunApiPayload['nodeRuns'],
): WorkflowRunArtifact[] {
  const collected: WorkflowRunArtifact[] = [];
  for (const node of nodeRuns ?? []) {
    const record = node as WorkflowRunNodeRun & { output?: unknown; input?: unknown };
    if (record.output) collected.push(...collectArtifactsFromOutput(record.output));
    const input = record.input;
    if (input && typeof input === 'object') {
      const fields = (input as { fields?: Record<string, { value?: unknown }> }).fields;
      if (fields) {
        for (const field of Object.values(fields)) {
          if (field?.value) collected.push(...collectArtifactsFromOutput(field.value));
        }
      }
    }
  }
  return collected;
}

/** Merge artifacts from all API locations; prefer OSS/http over artifact:// refs. */
export function collectAllRunArtifacts(run: WorkflowRunApiPayload): WorkflowRunArtifact[] {
  const pools = [
    normalizeRunArtifacts(run.artifacts),
    collectArtifactsFromOutput(run.output),
    collectArtifactsFromNodeRuns(run.nodeRuns),
  ].flat();

  const byName = new Map<string, WorkflowRunArtifact>();
  for (const artifact of pools) {
    const key = artifact.name || artifact.id || artifact.url;
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, artifact);
      continue;
    }
    const incomingHttp = isHttpArtifactUrl(artifact.url);
    const existingHttp = isHttpArtifactUrl(existing.url);
    if (incomingHttp && !existingHttp) {
      byName.set(key, artifact);
    } else if (incomingHttp && existingHttp && artifact.url.length > existing.url.length) {
      byName.set(key, artifact);
    }
  }

  const merged = [...byName.values()];
  const httpArtifacts = merged.filter((a) => isHttpArtifactUrl(a.url));
  return httpArtifacts.length > 0 ? httpArtifacts : merged;
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

function parseRunTimestampMs(value?: string | null): number | null {
  return parseWorkflowTimestampMs(value);
}

/** Earliest node start time from GET /runs nodeRuns. */
export function earliestNodeRunStartedAt(
  nodeRuns?: WorkflowRunApiPayload['nodeRuns'],
): string | undefined {
  let earliestMs: number | null = null;
  let earliestIso: string | undefined;
  for (const node of nodeRuns ?? []) {
    const ms = parseRunTimestampMs(node.startedAt);
    if (ms === null) continue;
    if (earliestMs === null || ms < earliestMs) {
      earliestMs = ms;
      earliestIso = node.startedAt;
    }
  }
  return earliestIso;
}

/** Prefer node timeline when API run.startedAt ≈ completedAt. */
export function resolveWorkflowRunStartedAt(run: WorkflowRunApiPayload): string | undefined {
  const completedMs = parseRunTimestampMs(run.completedAt);
  const candidates = [earliestNodeRunStartedAt(run.nodeRuns), run.startedAt].filter(
    (value, index, list): value is string => Boolean(value) && list.indexOf(value) === index,
  );

  if (candidates.length === 0) return undefined;
  if (completedMs === null) {
    return earliestNodeRunStartedAt(run.nodeRuns) ?? run.startedAt;
  }

  let best: string | undefined;
  let bestDurationMs = -1;
  for (const candidate of candidates) {
    const startMs = parseRunTimestampMs(candidate);
    if (startMs === null || startMs > completedMs) continue;
    const durationMs = completedMs - startMs;
    if (durationMs > bestDurationMs) {
      bestDurationMs = durationMs;
      best = candidate;
    }
  }

  return best ?? earliestNodeRunStartedAt(run.nodeRuns) ?? run.startedAt;
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
  const artifacts = collectAllRunArtifacts(run);

  return {
    runId: run.id,
    workflowId: run.workflowId,
    status,
    progress,
    currentStep: nodeRuns.find((n) => normalizeWorkflowStepStatus(n.status) === 'running')?.nodeId,
    startedAt: (() => {
      const resolved = resolveWorkflowRunStartedAt(run);
      return resolved ? normalizeWorkflowTimestamp(resolved) : undefined;
    })(),
    completedAt: run.completedAt ? normalizeWorkflowTimestamp(run.completedAt) : undefined,
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
  const artifacts = collectAllRunArtifacts(run);
  return extractRunResultFromPayload(run, status, artifacts);
}
