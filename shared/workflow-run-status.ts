export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'waiting_approval'
  | 'waiting_input'
  | 'unknown';

export interface WorkflowRunNodeRun {
  id: string;
  nodeId: string;
  nodeType?: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowRunArtifact {
  id: string;
  name: string;
  type: string;
  /** Preview / external-open URL (office viewer, inline HTML, etc.). */
  url: string;
  previewUrl?: string;
  /** Signed OSS download URL (Content-Disposition: attachment). */
  tempUrl?: string;
  size?: number;
  nodeId?: string;
  kind?: string;
}

export interface WorkflowExecutionResult {
  summary?: string;
  kpis?: Array<{
    name: string;
    value: string | number;
    change?: number;
    changeType?: 'increase' | 'decrease';
  }>;
  artifacts?: Array<{
    id: string;
    name: string;
    type: string;
    url: string;
    previewUrl?: string;
    tempUrl?: string;
    size?: number;
  }>;
}

export interface WorkflowExecutionState {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  progress: number;
  currentStep?: string;
  startedAt?: string;
  completedAt?: string;
  steps: Array<{
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    duration?: number;
    error?: string;
  }>;
  result?: WorkflowExecutionResult;
  error?: string;
  waitingNodeId?: string | null;
  approvalTasks?: unknown[];
  userInputTasks?: unknown[];
}
import { normalizeWorkflowTimestamp, parseWorkflowTimestampMs } from './workflow-timestamp';

/** Raw GET /runs payload — fields may be omitted while run is starting or on older backends. */
export interface WorkflowRunApiPayload {
  id: string;
  workflowId: string;
  status?: string | null;
  startedAt?: string;
  completedAt?: string | null;
  nodeRuns?: WorkflowRunNodeRun[] | null;
  artifacts?: Array<
    Partial<WorkflowRunArtifact> & {
      uri?: string;
      kind?: string;
      tempUrl?: string;
      previewUrl?: string;
      filePath?: string;
      contentType?: string;
      nodeId?: string;
    }
  > | null;
  output?: unknown;
  result?: {
    title?: string | null;
    summary?: string | null;
    status?: string | null;
    artifacts?: WorkflowRunApiPayload['artifacts'];
  } | null;
  error?: string | null;
  waitingNodeId?: string | null;
  approvalTasks?: unknown[] | null;
  userInputTasks?: unknown[] | null;
}

/** Map Agent Workflow API status values to UI status.
 *
 * 客户端本地执行体（engine.ts）以大写 DB 枚举落库（RUNNING/WAITING_APPROVAL/…），
 * renderer 端统一为小写 UI 枚举；两者都须归一化。
 * INTERRUPTED（崩溃收口）映射到 failed，保留 failed 语义。 */
export function normalizeWorkflowRunStatus(status: string | undefined | null): WorkflowRunStatus {
  switch (status?.toLowerCase()) {
    case 'succeed':
    case 'succeeded':
    case 'success':
    case 'completed':
      return 'completed';
    case 'failed':
    case 'error':
    case 'interrupted':
      return 'failed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'running':
      return 'running';
    case 'pending':
      return 'pending';
    case 'waiting_approval':
    case 'waiting approval':
      return 'waiting_approval';
    case 'waiting_input':
    case 'waiting input':
      return 'waiting_input';
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
  // active = 未结束且仍可流转（pending/running + 两种 waiting）。
  return (
    status === 'pending'
    || status === 'running'
    || status === 'waiting_approval'
    || status === 'waiting_input'
  );
}

export function isTerminalWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  // terminal = 终态，不再变化（completed/failed/timeout）。
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'timeout';
}

function isHttpArtifactUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Prefer signed in-app preview URL over raw OSS tempUrl (no VPN required). */
export function resolveWorkflowArtifactUrl(
  artifact: Partial<WorkflowRunArtifact> & {
    uri?: string;
    tempUrl?: string;
    previewUrl?: string;
  },
): string {
  return artifact.previewUrl?.trim()
    || artifact.tempUrl?.trim()
    || artifact.url?.trim()
    || artifact.uri?.trim()
    || '';
}

export function normalizeRunArtifacts(
  artifacts: WorkflowRunApiPayload['artifacts'],
): WorkflowRunArtifact[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((a) => {
      const contentType = a.contentType;
      const legacyUrl = a.url?.trim() || a.uri?.trim() || '';
      const tempUrl = a.tempUrl?.trim() || legacyUrl;
      const previewUrl = a.previewUrl?.trim() || legacyUrl || tempUrl;
      return {
        id: a.id ?? '',
        name: a.name ?? a.kind ?? 'artifact',
        type: a.type ?? a.kind ?? contentType ?? 'file',
        url: resolveWorkflowArtifactUrl(a) || previewUrl,
        previewUrl,
        tempUrl,
        size: a.size,
        nodeId: a.nodeId,
        kind: a.kind,
      };
    })
    .filter((a) => a.id || a.url || a.previewUrl || a.tempUrl);
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
    normalizeRunArtifacts(run.result?.artifacts),
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

  // Keep local artifacts alongside remote ones. De-duplication above already
  // prefers HTTP for the same artifact; globally dropping local entries would
  // hide a local HTML result whenever an unrelated OSS/JSON artifact exists.
  return [...byName.values()];
}

function isIntermediateArtifactKind(kind: string | undefined): boolean {
  const normalized = kind?.trim().toLowerCase();
  return normalized === 'input' || normalized === 'intermediate' || normalized === 'process';
}

/**
 * Return user-facing final artifacts only. Local execution persists inputs and
 * every node's files for audit/sync.  A client `agent_output` may already have
 * a materialized OUTPUT artifact before the terminal output node; it is a
 * user-facing result as well, not an intermediate merely because of node type.
 */
export function collectFinalRunArtifacts(run: WorkflowRunApiPayload): WorkflowRunArtifact[] {
  if (resolveWorkflowRunStatus(run) !== 'completed') return [];

  const resultArtifacts = normalizeRunArtifacts(run.result?.artifacts);
  const outputArtifacts = collectArtifactsFromOutput(run.output);
  const topLevel = normalizeRunArtifacts(run.artifacts);
  const outputNodeIds = new Set(
    (run.nodeRuns ?? [])
      .filter((node) => node.nodeType?.trim().toLowerCase() === 'output')
      .map((node) => node.nodeId),
  );
  // A local run's `result` is the latest agent output, not the workflow's final
  // output. Once output-node metadata exists, never merge that intermediate
  // agent result into the final artifact set.
  const explicit = outputNodeIds.size > 0
    ? outputArtifacts
    : [...resultArtifacts, ...outputArtifacts];

  let finalRows: WorkflowRunArtifact[];
  if (outputNodeIds.size > 0) {
    finalRows = topLevel.filter((artifact) => (
      (artifact.nodeId && outputNodeIds.has(artifact.nodeId))
      || artifact.kind?.trim().toUpperCase() === 'OUTPUT'
    ));
  } else if (explicit.length > 0) {
    const names = new Set(explicit.map((artifact) => artifact.name).filter(Boolean));
    finalRows = topLevel.filter((artifact) => names.has(artifact.name));
  } else {
    // Compatibility for older cloud payloads that did not return nodeType.
    finalRows = topLevel.filter((artifact) => !isIntermediateArtifactKind(artifact.kind));
  }

  const byName = new Map<string, WorkflowRunArtifact>();
  for (const artifact of [...explicit, ...finalRows]) {
    const key = artifact.name || artifact.id || artifact.url;
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing || (isHttpArtifactUrl(artifact.url) && !isHttpArtifactUrl(existing.url))) {
      byName.set(key, artifact);
    }
  }
  return [...byName.values()];
}

function mapArtifacts(artifacts: WorkflowRunArtifact[]) {
  return artifacts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    url: a.url,
    previewUrl: a.previewUrl,
    tempUrl: a.tempUrl,
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
  const artifacts = collectFinalRunArtifacts(run);

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
    waitingNodeId: run.waitingNodeId ?? null,
    approvalTasks: run.approvalTasks ?? [],
    userInputTasks: run.userInputTasks ?? [],
  };
}

function extractRunResultFromPayload(
  run: WorkflowRunApiPayload,
  status: WorkflowRunStatus,
  artifacts: WorkflowRunArtifact[],
): WorkflowExecutionResult | undefined {
  // Non-success states can already contain input/intermediate files for audit,
  // but they are not completed workflow results.
  if (status !== 'completed') return undefined;

  const mapped = mapArtifacts(artifacts);
  const outputSummary = extractOutputSummary(run.output);
  const hasOutputNode = (run.nodeRuns ?? []).some(
    (node) => node.nodeType?.trim().toLowerCase() === 'output',
  );
  const resultSummary = hasOutputNode ? undefined : extractOutputSummary(run.result)
    ?? (typeof run.result?.title === 'string' && run.result.title.trim()
      ? run.result.title.trim()
      : undefined);

  if (outputSummary) {
    return {
      summary: outputSummary,
      artifacts: mapped.length > 0 ? mapped : undefined,
    };
  }

  if (resultSummary) {
    return { summary: resultSummary, artifacts: mapped.length > 0 ? mapped : undefined };
  }

  return mapped.length > 0 ? { artifacts: mapped } : undefined;
}

/** Extract client-facing result summary + artifacts from GET /runs response. */
export function extractRunResult(run: WorkflowRunApiPayload): WorkflowExecutionResult | undefined {
  const status = resolveWorkflowRunStatus(run);
  const artifacts = collectFinalRunArtifacts(run);
  return extractRunResultFromPayload(run, status, artifacts);
}
