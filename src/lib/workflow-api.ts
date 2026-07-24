/**
 * Workflow API Client
 *
 * Aligned with Agent Workflow Client API v1.
 * All endpoints return { success, data, traceId } and require stoToken header.
 */
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { useAuthStore } from '@/stores/auth';
import type {
  ApiResponse,
  WorkflowTemplateSearchResponse,
  WorkflowTemplateListApiResponse,
  WorkflowTemplateListResult,
  StartupSchemaResponse,
  CreateWorkflowRequest,
  CreateWorkflowResponse,
  WorkflowDetailResponse,
  StartWorkflowRequest,
  StartWorkflowResponse,
  WorkflowRunResponse,
  WorkflowExecutionState,
} from '@/types/workflow';
import { workflowRunResponseToExecutionState } from '@/lib/workflow-run-status';
import { formatShanghaiIso } from '../../shared/workflow-timestamp';

/** Extract stoToken — prefer in-memory auth store (avoids zustand persist lag after login). */
export function getWorkflowStoToken(): string | undefined {
  const fromStore = useAuthStore.getState().user?.stoToken?.trim();
  if (fromStore) return fromStore;

  try {
    const raw = localStorage.getItem('stoclaw-auth');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { state?: { user?: { stoToken?: string } } };
    return parsed?.state?.user?.stoToken?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function generateTraceId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function authHeaders(): Record<string, string> {
  const token = getWorkflowStoToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Trace-Id': generateTraceId(),
  };
  if (token) headers.stoToken = token;
  return headers;
}

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success || res.data === null) {
    const msg =
      res.errMessage || (res.errCode ? `Workflow API error: ${res.errCode}` : 'Workflow API error');
    throw new Error(msg);
  }
  return res.data;
}

// ── 1. List templates (paginated) ───────────────────────────────
// FastAPI: POST /agent/v1/workflow-templates → memory-center workflow_client.py:list_templates

export interface ListWorkflowTemplatesParams {
  query?: string;
  page?: number;
  pageSize?: number;
}

export async function listWorkflowTemplates(
  params: ListWorkflowTemplatesParams = {}
): Promise<WorkflowTemplateListResult> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const query = params.query?.trim();
  const res = await hostApiFetch<WorkflowTemplateListApiResponse>('/agent/v1/workflow-templates', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...(query ? { query } : {}),
      page,
      pageSize,
    }),
  });
  if (!res.success || !res.data) {
    const msg =
      res.errMessage || (res.errCode ? `Workflow API error: ${res.errCode}` : 'Workflow API error');
    throw new Error(msg);
  }
  return {
    items: res.data,
    total: res.total ?? res.data.length,
    page: res.page ?? page,
    pageSize: res.pageSize ?? pageSize,
  };
}

const WORKFLOW_TEMPLATES_NO_ACCESS_MESSAGE =
  '未查询到可访问的工作流模板，您可能没有相关权限。请联系管理员申请工作流访问权限。';

/** Query templates by keyword; adapts paginated API to legacy matchedItems shape. */
export async function searchWorkflowTemplates(
  query: string,
  pageSize = 3
): Promise<WorkflowTemplateSearchResponse> {
  const trimmed = query.trim();
  const result = await listWorkflowTemplates({ query: trimmed, page: 1, pageSize });
  if (trimmed && result.items.length === 0) {
    throw new Error(`${WORKFLOW_TEMPLATES_NO_ACCESS_MESSAGE}（搜索：${trimmed}）`);
  }
  return {
    matchedItems: result.items,
    recommendedItems: [],
  };
}

// ── 2. Get startup schema ───────────────────────────────────────
// FastAPI: GET /agent/v1/workflow-templates/{template_id}/startup-schema → memory-center workflow_client.py:get_template_startup_schema

const startupSchemaCache = new Map<string, StartupSchemaResponse>();
const startupSchemaInflight = new Map<string, Promise<StartupSchemaResponse>>();

/** Clear cached startup schemas (tests or forced refresh). */
export function clearStartupSchemaCache(templateId?: string): void {
  if (templateId) {
    startupSchemaCache.delete(templateId);
    startupSchemaInflight.delete(templateId);
    return;
  }
  startupSchemaCache.clear();
  startupSchemaInflight.clear();
}

export async function getStartupSchema(templateId: string): Promise<StartupSchemaResponse> {
  const cached = startupSchemaCache.get(templateId);
  if (cached) {
    console.log(
      '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema cache=hit schemaHash=%s fields=%d steps=%d',
      templateId,
      cached.schemaHash,
      cached.schema?.fields?.length ?? 0,
      cached.schema?.steps?.length ?? 0
    );
    return cached;
  }

  const inflight = startupSchemaInflight.get(templateId);
  if (inflight) {
    console.log(
      '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema inflight=reuse',
      templateId
    );
    return inflight;
  }

  console.log('[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema', templateId);
  console.log(
    '[sto-workflow-tool] get_workflow_schema fetching startup-schema templateId=%s',
    templateId
  );

  const promise = unwrap(
    hostApiFetch<ApiResponse<StartupSchemaResponse>>(
      `/agent/v1/workflow-templates/${templateId}/startup-schema`,
      {
        headers: authHeaders(),
      }
    )
  )
    .then((data) => {
      startupSchemaCache.set(templateId, data);
      startupSchemaInflight.delete(templateId);
      console.log(
        '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema ok schemaHash=%s fields=%d steps=%d enabled=%s',
        templateId,
        data.schemaHash,
        data.schema?.fields?.length ?? 0,
        data.schema?.steps?.length ?? 0,
        String(data.schema?.enabled ?? false)
      );
      console.log(
        '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema response=%s',
        templateId,
        JSON.stringify(data)
      );
      return data;
    })
    .catch((err) => {
      startupSchemaInflight.delete(templateId);
      console.error(
        '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema failed error=%s',
        templateId,
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    });

  startupSchemaInflight.set(templateId, promise);
  return promise;
}

// ── 3. Create workflow ──────────────────────────────────────────
// FastAPI: POST /agent/v1/workflows → memory-center workflow_client.py:create_workflow

export async function createWorkflow(
  params: CreateWorkflowRequest
): Promise<CreateWorkflowResponse> {
  const init: RequestInit = {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
  };
  const data = await unwrap(
    hostApiFetch<ApiResponse<CreateWorkflowResponse>>('/agent/v1/workflows', init)
  );

  return data;
}

// ── 4. Get workflow detail ──────────────────────────────────────
// FastAPI: GET /agent/v1/workflows/{workflow_id} → memory-center workflow_client.py:get_workflow_detail

export async function getWorkflowDetail(workflowId: string): Promise<WorkflowDetailResponse> {
  try {
    const data = await unwrap(
      hostApiFetch<ApiResponse<WorkflowDetailResponse>>(`/agent/v1/workflows/${workflowId}`, {
        headers: authHeaders(),
      })
    );

    return data;
  } catch (err) {
    console.error(
      '[workflow-trace] GET /agent/v1/workflows/%s failed error=%s',
      workflowId,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
}

// ── 5. Start workflow ───────────────────────────────────────────
// FastAPI: POST /agent/v1/workflows/{workflow_id}/start → memory-center workflow_client.py:start_workflow

export async function startWorkflow(
  workflowId: string,
  params: StartWorkflowRequest
): Promise<StartWorkflowResponse> {
  const init: RequestInit = {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
  };
  const data = await unwrap(
    hostApiFetch<ApiResponse<StartWorkflowResponse>>(
      `/agent/v1/workflows/${workflowId}/start`,
      init
    )
  );
  if (!data.runId) {
    throw new Error('Start workflow response missing runId');
  }

  return data;
}

// ── 5b. Start workflow (client-side execution, v2) ──────────────
// FastAPI: POST /agent/v2/workflows/{workflow_id}/createRunLog → 仅建 workflow_run 行
// （source=client, mode=CLIENT_LOCAL, status=RUNNING），返回 runId + workflowVersionId。
// 后续执行下沉到客户端 engine（经 workflow-runtime:start IPC 触发），状态经
// 'workflow:status-update' 广播桥回流（Phase 2a-3 bootstrap.onStatusChange）。

/** v2 createRunLog 注册版响应：仅建行 + 钉定 version，无 streamUrl/queryUrl。 */
export interface StartWorkflowLocalResponse {
  runId: string;
  runDatabaseId: number;
  workflowVersionId: string | number;
  /** 用户可见的流程版本号（不同于 workflowVersionId 数据库主键）。 */
  workflowVersion?: string | number | null;
  resolvedInputs?: Record<string, unknown>;
}

export interface StartWorkflowLocalParams {
  workflowId: string;
  inputs?: Record<string, unknown>;
  agentContext?: Record<string, unknown>;
  idempotencyKey: string;
  /** 会话键——仅透传给本地 engine 落 wf_run.session_key，不发给后端。 */
  sessionKey: string;
  runMode?: 'trial' | 'production';
  workflowVersionId?: string | number;
  /** Fixed for the entire local run and persisted before dispatch. */
  engineType: 'claude' | 'openclaw';
}

export interface StartWorkflowLocalResult {
  runId: string;
  workflowId: string;
  /** 钉定版本，供 WorkflowExecutionRecord.versionId 落库 + hydration 用。 */
  versionId: string | number;
  /** 用户可见版本号，不同于 versionId 数据库主键。 */
  workflowVersion?: string | number | null;
  startedAt: string;
}

/**
 * v2 本地执行下沉入口：
 * 常规会话工作流：POST /agent/v2/workflows/{id}/createRunLog 注册后启动。
 * 画布试运行同样先保存到云端版本；客户端只按版本 ID 拉取执行 DSL。
 */
export async function startWorkflowLocal(
  params: StartWorkflowLocalParams
): Promise<StartWorkflowLocalResult> {
  const startedAt = formatShanghaiIso();

  // 常规会话工作流仍需在服务端注册，以保持既有运行记录关联行为。
  let data: StartWorkflowLocalResponse | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateRunDatabaseId = await invokeIpc<number>('workflow-runtime:takeDatabaseId');
    if (!Number.isSafeInteger(candidateRunDatabaseId) || candidateRunDatabaseId <= 0) {
      throw new Error('global workflow id pool returned an invalid run id');
    }
    try {
      data = await unwrap(
        hostApiFetch<ApiResponse<StartWorkflowLocalResponse>>(
          `/agent/v2/workflows/${params.workflowId}/createRunLog`,
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              runDatabaseId: candidateRunDatabaseId,
              inputs: params.inputs,
              agentContext: params.agentContext,
              idempotencyKey: params.idempotencyKey,
              runMode: params.runMode ?? 'production',
              workflowVersionId: params.workflowVersionId,
            }),
          }
        )
      );
      break;
    } catch (error) {
      const status = (error as { details?: { status?: number } }).details?.status;
      if (status !== 409 || attempt === 1) throw error;
    }
  }
  if (!data?.runId || data.workflowVersionId == null || !Number.isSafeInteger(data.runDatabaseId)) {
    throw new Error('v2 createRunLog response missing runId/workflowVersionId/runDatabaseId');
  }

  // 2. 本地执行下沉：IPC handler 在主进程 await 整个 run（dispatch 到终态/等待节点），
  //    renderer 不 await——状态走广播桥回流。
  await invokeIpc('workflow-runtime:start', {
    runId: data.runId,
    runDatabaseId: data.runDatabaseId,
    workflowId: params.workflowId,
    versionId: String(data.workflowVersionId), // engine dslClient.fetchVersion(workflowId, versionId: string)
    workflowVersion: data.workflowVersion,
    input: data.resolvedInputs ?? params.inputs ?? {},
    startedAt,
    sessionKey: params.sessionKey,
    engineType: params.engineType,
  });

  return {
    runId: data.runId,
    workflowId: params.workflowId,
    versionId: data.workflowVersionId,
    workflowVersion: data.workflowVersion,
    startedAt,
  };
}

// ── 6. Get run status ───────────────────────────────────────────
// FastAPI: GET /agent/v1/runs/{run_id} → memory-center workflow_client.py:get_workflow_run

export async function getWorkflowRun(runId: string): Promise<WorkflowRunResponse> {
  const data = await unwrap(
    hostApiFetch<ApiResponse<WorkflowRunResponse>>(`/agent/v1/runs/${runId}`, {
      headers: authHeaders(),
    })
  );

  return data;
}

// ── 6b. Get run via client-local runtime IPC (gap3 hydration) ────
//   Client-local executions live in the renderer-side DB (wf_run / wf_node_run).
//   The workflow-runtime:getRun IPC reads from that local store and returns the
//   full WorkflowRunResponse (or null when the run row is absent — e.g. a run
//   owned by another site or not yet persisted). Used by card hydration on
//   session switch / app init, where the authoritative source is the local DB
//   rather than the backend HTTP route above.

export async function getRunViaIpc(runId: string): Promise<WorkflowRunResponse | null> {
  return invokeIpc<WorkflowRunResponse | null>('workflow-runtime:getRun', runId);
}

/** Lightweight local-run list for the canvas history dialog. */
export interface LocalWorkflowRunSummary {
  runId: string;
  workflowId: string;
  versionId: string;
  /** 用户可见的流程版本号；versionId 仅用于运行时拉取版本 DSL。 */
  workflowVersion: string | number | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

export async function listLocalWorkflowRuns(workflowId: string): Promise<LocalWorkflowRunSummary[]> {
  return invokeIpc<LocalWorkflowRunSummary[]>('workflow-runtime:listRuns', workflowId);
}

// ── 6c. Cancel run (client-local runtime IPC) ───────────────────
//   Pure client-side cancel: signals the local engine to stop the active
//   agent query (sdk.close()) + marks the run CANCELLED + outbox syncs
//   terminal. The admin POST /runs/{id}/cancel is disabled for client runs
//   (see workflow-canvas-client-native-migration spec §5).

export async function cancelRun(runId: string): Promise<void> {
  await invokeIpc('workflow-runtime:cancel', runId);
}

/** Continue a user-cancelled local run from its first unfinished node. */
export async function resumeWorkflowRun(runId: string): Promise<void> {
  await invokeIpc('workflow-runtime:resume', runId);
}

export async function resumeWorkflowApproval(
  runId: string,
  nodeId: string,
  decision: { approved: boolean; note?: string },
): Promise<void> {
  await invokeIpc('workflow-runtime:resumeApproval', { runId, nodeId, decision });
}

export async function submitWorkflowInput(
  runId: string,
  nodeId: string,
  submittedData: Record<string, unknown>,
): Promise<void> {
  await invokeIpc('workflow-runtime:resumeInput', { runId, nodeId, submittedData });
}

export async function retryWorkflowSync(runId?: string): Promise<void> {
  await invokeIpc('workflow-runtime:retrySync', runId);
}

// ── Helper: convert WorkflowRunResponse to UI execution state ───

export function runToExecutionState(run: WorkflowRunResponse): WorkflowExecutionState {
  return workflowRunResponseToExecutionState(run);
}

// ── 7. Subscribe to run stream (SSE) ────────────────────────────
//   Migrated to client-side execution. The legacy SSE / IPC
//   subscription stack (isElectronRenderer, parseRunUpdateEvent,
//   subscribeWorkflowRun, subscribeWorkflowRunViaIpc,
//   beginWorkflowRunSseTrace, fetchWorkflowStatus) has been removed.
//   Runtime push is delivered by the client-local workflow runtime
//   via the workflow-runtime:* channels.


// ── 8. Save / publish workflow definition (designer) ─────────────
// FastAPI: PUT  /agent/v1/workflows/{workflow_id}       → memory-center workflow_client.py:save_workflow
// FastAPI: POST /agent/v1/workflows/{workflow_id}/publish → memory-center workflow_client.py:publish_workflow

export async function saveWorkflowDefinition(
  workflowId: string,
  workflow: Record<string, unknown>
): Promise<import('@/pages/WorkflowDesigner/types').WorkflowDefinition> {
  const { definitionFromDetail } = await import('@/lib/workflow-designer-adapter');
  const data = await unwrap(
    hostApiFetch<ApiResponse<WorkflowDetailResponse>>(`/agent/v1/workflows/${workflowId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(workflow),
    })
  );
  return definitionFromDetail(data);
}

export async function publishWorkflowDefinition(
  workflowId: string
): Promise<import('@/pages/WorkflowDesigner/types').WorkflowDefinition> {
  const { definitionFromDetail } = await import('@/lib/workflow-designer-adapter');
  const data = await unwrap(
    hostApiFetch<ApiResponse<WorkflowDetailResponse>>(`/agent/v1/workflows/${workflowId}/publish`, {
      method: 'POST',
      headers: authHeaders(),
      body: '{}',
    })
  );
  return definitionFromDetail(data);
}

// ── 9. Rename workflow ──────────────────────────────────────────
// FastAPI: PUT /agent/v1/workflows/{workflow_id}/name → memory-center workflow_client.py:rename_workflow

export async function renameWorkflow(workflowId: string, name: string): Promise<void> {
  console.log('[workflow-trace] PUT /agent/v1/workflows/%s/name name=%s', workflowId, name);
  const init: RequestInit = {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  };
  await unwrap(
    hostApiFetch<ApiResponse<{ workflowId: string; name: string }>>(
      `/agent/v1/workflows/${workflowId}/name`,
      init
    )
  );
  console.log('[workflow-trace] PUT /agent/v1/workflows/%s/name ok name=%s', workflowId, name);
}

// ── 10. Delete workflow ──────────────────────────────────────────
// FastAPI: DELETE /agent/v1/workflows/{workflow_id} → memory-center workflow_client.py:delete_workflow

export async function deleteWorkflow(workflowId: string): Promise<void> {
  console.log('[workflow-trace] DELETE /agent/v1/workflows/%s', workflowId);
  const init: RequestInit = {
    method: 'DELETE',
    headers: authHeaders(),
  };
  await unwrap(hostApiFetch<ApiResponse<null>>(`/agent/v1/workflows/${workflowId}`, init));
  console.log('[workflow-trace] DELETE /agent/v1/workflows/%s ok', workflowId);
}
