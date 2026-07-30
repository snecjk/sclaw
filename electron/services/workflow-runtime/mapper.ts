import { normalizeWorkflowRunStatus, workflowRunResponseToExecutionState } from '../../../shared/workflow-run-status';
import type { WorkflowExecutionState } from '../../../shared/workflow-run-status';
import { pathToFileURL } from 'node:url';

type WorkflowRunInput = { inputs: Record<string, unknown>; agentContext: Record<string, unknown>; startup: any };
type WorkflowRunResponse = any;

/** 0003 迁移引入的 session_key 字段（repo 直查为 snake_case 行）。 */
export interface WfRunRow {
  run_id: string;
  workflow_id: string;
  version_id: string;
  workflow_version?: string | number | null;
  status: string;
  mode?: string | null;
  source?: string | null;
  waiting_node_id?: string | null;
  input_json?: string | null;
  output_json?: string | null;
  last_agent_output_json?: string | null;
  last_agent_raw_text?: string | null;
  definition_json?: string | null;
  error?: string | null;
  started_at: string;
  completed_at?: string | null;
  updated_at?: string;
  synced_at?: string | null;
  session_key?: string | null;
  engine_type?: string | null;
  engine_model?: string | null;
}

export interface WfNodeRunRow {
  run_id: string;
  node_id: string;
  node_type: string | null;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  input_json?: string | null;
  output_json?: string | null;
  error?: string | null;
  last_completion_issue?: string | null;
  attempt_count?: number | null;
  agent_session_id?: string | null;
}

export interface WfEventRow {
  run_id: string;
  sequence: number;
  type: string;
  node_id?: string | null;
  run_ref_id?: string | null;
  skill_id?: string | null;
  tool_id?: string | null;
  call_id?: string | null;
  approval_id?: string | null;
  output_uri?: string | null;
  file_path?: string | null;
  reason?: string | null;
  message?: string | null;
  created_at: string;
}

export interface LocalRunChildren {
  view?: 'status' | 'detail' | 'diagnostic';
  nodeRuns?: WfNodeRunRow[];
  events?: WfEventRow[];
  approvalTasks?: any[];
  userInputTasks?: any[];
  artifacts?: any[];
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Map a local DB `wf_run` row (+ optional child rows) to the renderer-facing WorkflowRunResponse.
 *
 * 用于 gap3 hydration：renderer 重载后通过 `workflow-runtime:getRun` IPC 取回本地执行体状态，
 * 再经 `workflowRunResponseToExecutionState` 归一化为 `WorkflowExecutionState`。
 * nodeRuns 等子表由调用方按需传入；缺省返回空数组以兼容仅做状态 hydrate 的场景。 */
export function mapWfRunRowToResponse(
  row: WfRunRow,
  opts: LocalRunChildren = {},
): WorkflowRunResponse {
  const view = opts.view ?? 'status';
  const diagnostic = view === 'diagnostic';
  const includeTimeline = view === 'detail' || diagnostic;
  // workflowRunResponseToExecutionState 内部以 intersection 类型读取每个 nodeRun 的
  // output/input（collectArtifactsFromNodeRuns），故这里按需透传 extra 字段。
  const nodeRuns = (opts.nodeRuns ?? []).map((n) => ({
    id: `${row.run_id}:${n.node_id}`,
    nodeId: n.node_id,
    nodeType: n.node_type ?? undefined,
    status: n.status,
    startedAt: n.started_at ?? undefined,
    completedAt: n.completed_at ?? undefined,
    error: n.last_completion_issue ?? n.error ?? undefined,
    ...(diagnostic ? {
      attemptCount: n.attempt_count ?? 0,
      agentSessionId: n.agent_session_id ?? undefined,
      input: safeParse(n.input_json, undefined),
      output: safeParse(n.output_json, undefined),
    } : {}),
  }));

  // input_json 存的是 StartWorkflowArgs.input（松散 any，非严格 WorkflowRunInput 形状）。
  // 解析成功即透传；解析失败/为空时退化为空 inputs，保证类型守恒。
  const localArtifactRows = opts.artifacts ?? [];
  const output = enrichPacketArtifactsForLocalPreview(safeParse(row.output_json, null), localArtifactRows);
  let input: WorkflowRunInput | undefined;
  let result: WorkflowRunResponse['result'] | undefined;
  if (diagnostic) {
    const parsedInput = safeParse<Record<string, unknown>>(row.input_json, {});
    input = (parsedInput && typeof parsedInput === 'object' && 'inputs' in parsedInput
      ? parsedInput
      : { inputs: parsedInput, agentContext: {}, startup: buildStartupFromDefinition(row) }) as unknown as WorkflowRunInput;
    // last_agent_output_json is diagnostic history, not the final workflow output.
    result = enrichPacketArtifactsForLocalPreview(safeParse<WorkflowRunResponse['result']>(
      row.status === 'FAILED' ? row.output_json : row.last_agent_output_json,
      null,
    ), localArtifactRows);
  }

  const finalArtifactRows = diagnostic
    ? localArtifactRows
    : localArtifactRows.filter((artifact) => String(artifact.kind ?? '').toUpperCase() === 'OUTPUT');
  const response: WorkflowRunResponse = {
    id: row.run_id,
    workflowId: row.workflow_id,
    status: normalizeWorkflowRunStatus(row.status),
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.waiting_node_id ? { waitingNodeId: row.waiting_node_id } : {}),
    nodeRuns,
    ...(includeTimeline ? { events: (opts.events ?? []).map((event) => ({
      id: `${event.run_id}:${event.sequence}`,
      sequence: event.sequence,
      type: event.type,
      nodeId: event.node_id ?? undefined,
      timestamp: event.created_at,
      payload: safeParse(event.message, event.message ?? null),
    })) } : {}),
    ...((opts.approvalTasks?.length ?? 0) > 0 ? { approvalTasks: opts.approvalTasks!.map((task) => ({
      id: task.task_id, nodeId: task.node_id, status: task.status,
      assigneeRole: task.assignee_role, reason: task.reason, decisionNote: task.decision_note,
      requestedAt: task.requested_at, decidedAt: task.decided_at,
    })) } : {}),
    ...((opts.userInputTasks?.length ?? 0) > 0 ? { userInputTasks: opts.userInputTasks!.map((task) => ({
      id: task.task_id, nodeId: task.node_id, status: task.status,
      title: task.title, instruction: task.instruction,
      schema: safeParse(task.form_schema_json, []), values: safeParse(task.submitted_data_json, {}),
      requestedAt: task.requested_at, submittedAt: task.submitted_at,
    })) } : {}),
    artifacts: finalArtifactRows.map((artifact) => ({
      id: artifact.artifact_id, nodeId: artifact.node_id, kind: artifact.kind,
      name: artifact.summary || artifact.file_path?.split(/[\\/]/).pop() || 'artifact',
      type: artifact.content_type || artifact.kind,
      url: artifact.file_path ? pathToFileURL(artifact.file_path).href : artifact.uri || '',
      uri: artifact.uri, filePath: artifact.file_path, contentType: artifact.content_type,
    })),
    output,
    ...(row.error ? { error: row.error } : {}),
    ...(includeTimeline && row.last_agent_raw_text ? { lastAgentRawText: row.last_agent_raw_text } : {}),
    ...(diagnostic ? {
      versionId: row.version_id,
      workflowVersion: resolveWorkflowVersion(row),
      mode: row.mode ?? null,
      engineType: row.engine_type === 'openclaw' ? 'openclaw' : 'claude',
      engineModel: row.engine_model ?? null,
      input,
      result,
      startup: buildStartupFromDefinition(row),
    } : {}),
  };
  return response;
}

/**
 * Add renderer-only local preview fields to a parsed packet copy. Canonical
 * resourceId/artifact:// values remain untouched in SQLite and sync payloads.
 */
function enrichPacketArtifactsForLocalPreview<T>(value: T, artifactRows: any[]): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const packet = value as Record<string, unknown>;
  if (!Array.isArray(packet.artifacts) || !artifactRows.length) return value;
  const localById = new Map(artifactRows
    .filter((row) => typeof row?.artifact_id === 'string' && typeof row?.file_path === 'string' && row.file_path)
    .map((row) => [row.artifact_id, row]));
  if (!localById.size) return value;

  const artifacts = packet.artifacts.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const artifact = entry as Record<string, unknown>;
    const artifactId = typeof artifact.artifactId === 'string'
      ? artifact.artifactId
      : typeof artifact.id === 'string' ? artifact.id : '';
    const local = localById.get(artifactId);
    if (!local) return entry;
    const filePath = String(local.file_path);
    return { ...artifact, filePath, url: pathToFileURL(filePath).href };
  });
  return { ...packet, artifacts } as T;
}

function resolveWorkflowVersion(row: Pick<WfRunRow, 'workflow_version' | 'definition_json'>): string | number | null {
  if (typeof row.workflow_version === 'number' && Number.isFinite(row.workflow_version)) return row.workflow_version;
  if (typeof row.workflow_version === 'string' && row.workflow_version.trim()) return row.workflow_version;
  const definition = safeParse<Record<string, unknown>>(row.definition_json, {});
  const version = definition.version;
  return typeof version === 'number' && Number.isFinite(version)
    ? version
    : typeof version === 'string' && version.trim() ? version : null;
}

/** 由 definition_json 构造最小可用 WorkflowRunStartupInfo。
 * 客户端本地执行体不经过 MC 端 schema/preset 解析，仅保证字段存在以兼容类型；
 * workflowRunResponseToExecutionState 不读取 startup，故仅需形状守恒。 */
function buildStartupFromDefinition(row: WfRunRow): WorkflowRunResponse['startup'] {
  const definition = safeParse<any>(row.definition_json, {});
  const startupNode = (definition.nodes ?? []).find((node: any) => node.type === 'startup_config');
  const fields = startupNode?.config?.fields ?? [];
  const resolvedInputs = safeParse<Record<string, unknown>>(row.input_json, {});
  return {
    schemaHash: '',
    schema: { nodeId: startupNode?.id ?? '', enabled: fields.length > 0, steps: startupNode?.config?.steps ?? [], fields },
    presetId: '',
    presetName: '',
    presetVersionId: 0,
    resolvedInputs,
  };
}

/** Map a local DB `wf_run` row directly to the UI execution state.
 *
 * gap3 hydration 路径：getRun IPC → mapWfRunRowToResponse → workflowRunResponseToExecutionState。
 * 单独导出便于调用方一步到位，同时补齐 `waitingNodeId`（workflowRunResponseToExecutionState 暂未透传该字段）。 */
export function mapWfRunRowToExecutionState(
  row: WfRunRow,
  opts: LocalRunChildren = {},
): WorkflowExecutionState & { sessionKey?: string | null } {
  const response = mapWfRunRowToResponse(row, opts);
  const base = workflowRunResponseToExecutionState(response);
  return {
    ...base,
    waitingNodeId: response.waitingNodeId,
    sessionKey: row.session_key ?? null,
  };
}
