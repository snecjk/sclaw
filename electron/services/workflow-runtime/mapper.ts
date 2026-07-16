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
  attempt?: number | null;
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
  // workflowRunResponseToExecutionState 内部以 intersection 类型读取每个 nodeRun 的
  // output/input（collectArtifactsFromNodeRuns），故这里按需透传 extra 字段。
  const nodeRuns = (opts.nodeRuns ?? []).map((n) => ({
    id: `${row.run_id}:${n.node_id}`,
    nodeId: n.node_id,
    status: n.status,
    startedAt: n.started_at ?? undefined,
    completedAt: n.completed_at ?? undefined,
    error: n.error ?? undefined,
    input: safeParse(n.input_json, undefined),
    output: safeParse(n.output_json, undefined),
  }));

  // input_json 存的是 StartWorkflowArgs.input（松散 any，非严格 WorkflowRunInput 形状）。
  // 解析成功即透传；解析失败/为空时退化为空 inputs，保证类型守恒。
  const parsedInput = safeParse<Record<string, unknown>>(row.input_json, {});
  const input = (parsedInput && typeof parsedInput === 'object' && 'inputs' in parsedInput
    ? parsedInput
    : { inputs: parsedInput, agentContext: {}, startup: buildStartupFromDefinition(row) }) as unknown as WorkflowRunInput;

  // last_agent_output_json 存放 engine 产出的 client result（见 engine.ts result 落库）。
  const result = safeParse<WorkflowRunResponse['result']>(row.last_agent_output_json, null);

  return {
    id: row.run_id,
    workflowId: row.workflow_id,
    status: normalizeWorkflowRunStatus(row.status),
    mode: row.mode ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
    waitingNodeId: row.waiting_node_id ?? null,
    nodeRuns,
    events: (opts.events ?? []).map((event) => ({
      id: `${event.run_id}:${event.sequence}`,
      sequence: event.sequence,
      type: event.type,
      nodeId: event.node_id ?? undefined,
      timestamp: event.created_at,
      payload: safeParse(event.message, event.message ?? null),
    })),
    approvalTasks: (opts.approvalTasks ?? []).map((task) => ({
      id: task.task_id, nodeId: task.node_id, status: task.status,
      assigneeRole: task.assignee_role, reason: task.reason, decisionNote: task.decision_note,
      requestedAt: task.requested_at, decidedAt: task.decided_at,
    })),
    userInputTasks: (opts.userInputTasks ?? []).map((task) => ({
      id: task.task_id, nodeId: task.node_id, status: task.status,
      title: task.title, instruction: task.instruction,
      schema: safeParse(task.form_schema_json, []), values: safeParse(task.submitted_data_json, {}),
      requestedAt: task.requested_at, submittedAt: task.submitted_at,
    })),
    artifacts: (opts.artifacts ?? []).map((artifact) => ({
      id: artifact.artifact_id, nodeId: artifact.node_id, kind: artifact.kind,
      name: artifact.summary || artifact.file_path?.split(/[\\/]/).pop() || 'artifact',
      type: artifact.content_type || artifact.kind,
      url: artifact.file_path ? pathToFileURL(artifact.file_path).href : artifact.uri || '',
      uri: artifact.uri, filePath: artifact.file_path, contentType: artifact.content_type,
    })),
    toolInvocations: (opts.events ?? [])
      .filter((event) => event.type === 'agent.tool_start' || event.type === 'agent.tool_end')
      .map((event) => ({
        id: event.call_id ?? `${event.run_id}:${event.sequence}`, nodeId: event.node_id,
        toolId: event.tool_id, status: event.type === 'agent.tool_end' ? 'COMPLETED' : 'REQUESTED',
        payload: safeParse(event.message, event.message ?? null), timestamp: event.created_at,
      })),
    input,
    result,
    output: safeParse(row.output_json, null),
    startup: buildStartupFromDefinition(row),
    lastAgentRawText: row.last_agent_raw_text ?? null,
    error: row.error ?? null,
  };
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
