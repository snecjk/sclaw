/**
 * Workflow API Client
 *
 * Aligned with Agent Workflow Client API v1.
 * All endpoints return { success, data, traceId } and require stoToken header.
 */
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch, hostApiFetchStream } from '@/lib/host-api';
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
    const msg = res.errMessage || (res.errCode ? `Workflow API error: ${res.errCode}` : 'Workflow API error');
    throw new Error(msg);
  }
  return res.data;
}

// ── 1. List templates (paginated) ───────────────────────────────

export interface ListWorkflowTemplatesParams {
  query?: string;
  page?: number;
  pageSize?: number;
}

export async function listWorkflowTemplates(
  params: ListWorkflowTemplatesParams = {},
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
    const msg = res.errMessage || (res.errCode ? `Workflow API error: ${res.errCode}` : 'Workflow API error');
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
  pageSize = 3,
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

export async function getStartupSchema(templateId: string): Promise<StartupSchemaResponse> {
  console.log(
    '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema',
    templateId,
  );
  const data = await unwrap(
    hostApiFetch<ApiResponse<StartupSchemaResponse>>(`/agent/v1/workflow-templates/${templateId}/startup-schema`, {
      headers: authHeaders(),
    }),
  );
  console.log(
    '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema ok schemaHash=%s fields=%d steps=%d enabled=%s',
    templateId,
    data.schemaHash,
    data.schema?.fields?.length ?? 0,
    data.schema?.steps?.length ?? 0,
    String(data.schema?.enabled ?? false),
  );
  console.log(
    '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema response=%s',
    templateId,
    JSON.stringify(data),
  );
  return data;
}

// ── 3. Create workflow ──────────────────────────────────────────

export async function createWorkflow(params: CreateWorkflowRequest): Promise<CreateWorkflowResponse> {
  console.log(
    '[workflow-trace] POST /agent/v1/workflows templateId=%s idempotencyKey=%s startupKeys=%o',
    params.templateId,
    params.idempotencyKey,
    Object.keys(params.startup ?? {}),
  );
  const init: RequestInit = {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
  };
  const data = await unwrap(
    hostApiFetch<ApiResponse<CreateWorkflowResponse>>('/agent/v1/workflows', init),
  );
  console.log(
    '[workflow-trace] POST /agent/v1/workflows ok workflowId=%s templateId=%s',
    data.workflowId,
    params.templateId,
  );
  return data;
}

// ── 4. Get workflow detail ──────────────────────────────────────

export async function getWorkflowDetail(workflowId: string): Promise<WorkflowDetailResponse> {
  console.log('[workflow-trace] GET /agent/v1/workflows/%s', workflowId);
  try {
    const data = await unwrap(
      hostApiFetch<ApiResponse<WorkflowDetailResponse>>(`/agent/v1/workflows/${workflowId}`, {
        headers: authHeaders(),
      }),
    );
    console.log(
      '[workflow-trace] GET /agent/v1/workflows/%s ok name=%s nodes=%d edges=%d steps=%d fields=%d preset=%s',
      workflowId,
      data.workflowName,
      data.nodes?.length ?? 0,
      data.edges?.length ?? 0,
      data.startup?.schema?.steps?.length ?? 0,
      data.startup?.schema?.fields?.length ?? 0,
      data.startup?.defaultPreset ? 'yes' : 'no',
    );
    console.log(
      '[workflow-trace] GET /agent/v1/workflows/%s response=%s',
      workflowId,
      JSON.stringify(data),
    );
    return data;
  } catch (err) {
    console.error(
      '[workflow-trace] GET /agent/v1/workflows/%s failed error=%s',
      workflowId,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

// ── 5. Start workflow ───────────────────────────────────────────

export async function startWorkflow(
  workflowId: string,
  params: StartWorkflowRequest,
): Promise<StartWorkflowResponse> {
  console.log(
    '[workflow-trace] POST /agent/v1/workflows/%s/start idempotencyKey=%s inputKeys=%o',
    workflowId,
    params.idempotencyKey,
    Object.keys(params.inputs ?? {}),
  );
  const init: RequestInit = {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
  };
  const data = await unwrap(
    hostApiFetch<ApiResponse<StartWorkflowResponse>>(`/agent/v1/workflows/${workflowId}/start`, init),
  );
  if (!data.runId) {
    throw new Error('Start workflow response missing runId');
  }
  console.log(
    '[workflow-trace] POST /agent/v1/workflows/%s/start ok runId=%s status=%s',
    workflowId,
    data.runId,
    data.status,
  );
  return data;
}

// ── 6. Get run status ───────────────────────────────────────────

export async function getWorkflowRun(runId: string): Promise<WorkflowRunResponse> {
  const data = await unwrap(
    hostApiFetch<ApiResponse<WorkflowRunResponse>>(`/agent/v1/runs/${runId}`, {
      headers: authHeaders(),
    }),
  );
  console.log(`[workflow-trace] GET /agent/v1/runs/${runId} response body:`, JSON.stringify(data, null, 2));
  return data;
}

// ── Helper: convert WorkflowRunResponse to UI execution state ───

export function runToExecutionState(run: WorkflowRunResponse): WorkflowExecutionState {
  return workflowRunResponseToExecutionState(run);
}

// ── 7. Subscribe to run stream (SSE) ────────────────────────────

function isElectronRenderer(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electron?.ipcRenderer);
}

function parseRunUpdateEvent(
  runId: string,
  currentData: string,
  eventCount: number,
  onEvent: (data: WorkflowRunResponse) => void,
  onError?: (error: Error) => void,
): void {
  try {
    const payload = JSON.parse(currentData) as WorkflowRunResponse;
    console.log(
      '[workflow-trace] SSE run.update #%d runId=%s status=%s nodeRuns=%d',
      eventCount,
      runId,
      payload.status,
      payload.nodeRuns?.length ?? 0,
    );
    onEvent(payload);
  } catch (e) {
    const parseError = new Error(`SSE parse error: ${String(e)}`);
    console.error('[workflow-trace] SSE parse error runId=%s %s', runId, parseError.message);
    onError?.(parseError);
  }
}

function subscribeWorkflowRunViaIpc(
  runId: string,
  onEvent: (data: WorkflowRunResponse) => void,
  onError?: (error: Error) => void,
): () => void {
  let eventCount = 0;
  console.log('[workflow-trace] IPC workflow:stream:subscribe runId=%s (backend via resolveStoBaseUrl)', runId);

  void invokeIpc('workflow:stream:subscribe', runId).catch((err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[workflow-trace] IPC workflow:stream:subscribe failed runId=%s: %s', runId, error.message);
    onError?.(error);
  });

  const eventHandler = (payload: unknown) => {
    const data = payload as { runId: string; event: string; data: string };
    if (data.runId !== runId) return;
    if (data.event !== 'run.update') {
      console.log('[workflow-trace] SSE event=%s runId=%s (ignored)', data.event, runId);
      return;
    }
    eventCount += 1;
    parseRunUpdateEvent(runId, data.data, eventCount, onEvent, onError);
  };

  const errorHandler = (payload: unknown) => {
    const data = payload as { runId: string; error: string; url?: string };
    if (data.runId !== runId) return;
    const detail = data.url ? `${data.error} (url=${data.url})` : data.error;
    const error = new Error(detail);
    console.error('[workflow-trace] IPC SSE error runId=%s url=%s: %s', runId, data.url ?? '', data.error);
    onError?.(error);
  };

  const unsubEvent = window.electron!.ipcRenderer.on('workflow:stream:event', eventHandler);
  const unsubError = window.electron!.ipcRenderer.on('workflow:stream:error', errorHandler);

  return () => {
    console.log('[workflow-trace] IPC workflow:stream:unsubscribe runId=%s events=%d', runId, eventCount);
    unsubEvent?.();
    unsubError?.();
    void invokeIpc('workflow:stream:unsubscribe', runId).catch(() => {});
  };
}

/**
 * Subscribe to real-time workflow run updates via SSE.
 * Electron: Main process proxies to resolveStoBaseUrl() (same domain as create/start).
 * Browser fallback: direct fetch to local Host API.
 */
export function subscribeWorkflowRun(
  runId: string,
  onEvent: (data: WorkflowRunResponse) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isElectronRenderer()) {
    return subscribeWorkflowRunViaIpc(runId, onEvent, onError);
  }

  const abort = new AbortController();
  let closed = false;
  let eventCount = 0;

  const connect = async () => {
    const streamPath = `/agent/v1/runs/${runId}/stream`;
    console.log('[workflow-trace] GET %s connecting (SSE browser fallback)...', streamPath);
    try {
      const response = await hostApiFetchStream(streamPath, {
        headers: authHeaders(),
        signal: abort.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      console.log(
        '[workflow-trace] GET %s connected status=%s contentType=%s',
        streamPath,
        response.status,
        response.headers.get('content-type') ?? '',
      );

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!closed && !abort.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentData += line.slice(5);
          } else if (line === '' && currentEvent && currentData) {
            if (currentEvent === 'run.update') {
              eventCount += 1;
              parseRunUpdateEvent(runId, currentData, eventCount, onEvent, onError);
            } else {
              console.log('[workflow-trace] SSE event=%s runId=%s (ignored)', currentEvent, runId);
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }

      console.log(
        '[workflow-trace] GET %s stream ended runId=%s events=%d closed=%s aborted=%s',
        streamPath,
        runId,
        eventCount,
        closed,
        abort.signal.aborted,
      );
    } catch (err) {
      if (closed || abort.signal.aborted) {
        console.log('[workflow-trace] GET /agent/v1/runs/%s/stream closed runId=%s events=%d', runId, runId, eventCount);
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[workflow-trace] GET /agent/v1/runs/%s/stream error: %s', runId, error.message);
      onError?.(error);
    }
  };

  void connect();

  return () => {
    console.log('[workflow-trace] GET /agent/v1/runs/%s/stream unsubscribe runId=%s events=%d', runId, runId, eventCount);
    closed = true;
    abort.abort();
  };
}

/** Fire-and-forget SSE trace subscription after a workflow run starts. */
export function beginWorkflowRunSseTrace(runId: string): void {
  subscribeWorkflowRun(
    runId,
    () => { /* trace-only; IPC polling drives UI updates */ },
    (error) => {
      console.warn('[workflow-trace] SSE trace stopped runId=%s: %s', runId, error.message);
    },
  );
}

// ── 8. Rename workflow ──────────────────────────────────────────

export async function renameWorkflow(workflowId: string, name: string): Promise<void> {
  console.log(
    '[workflow-trace] PUT /agent/v1/workflows/%s/name name=%s',
    workflowId,
    name,
  );
  const init: RequestInit = {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  };
  await unwrap(
    hostApiFetch<ApiResponse<{ workflowId: string; name: string }>>(`/agent/v1/workflows/${workflowId}/name`, init),
  );
  console.log(
    '[workflow-trace] PUT /agent/v1/workflows/%s/name ok name=%s',
    workflowId,
    name,
  );
}

// ── 9. Delete workflow ──────────────────────────────────────────

export async function deleteWorkflow(workflowId: string): Promise<void> {
  console.log(
    '[workflow-trace] DELETE /agent/v1/workflows/%s',
    workflowId,
  );
  const init: RequestInit = {
    method: 'DELETE',
    headers: authHeaders(),
  };
  await unwrap(
    hostApiFetch<ApiResponse<null>>(`/agent/v1/workflows/${workflowId}`, init),
  );
  console.log(
    '[workflow-trace] DELETE /agent/v1/workflows/%s ok',
    workflowId,
  );
}

// ── Legacy compatibility: query execution status (fallback) ─────

export async function fetchWorkflowStatus(runId: string): Promise<WorkflowExecutionState | null> {
  try {
    const run = await getWorkflowRun(runId);
    return runToExecutionState(run);
  } catch (err) {
    console.warn('[workflow-trace] fetchWorkflowStatus failed runId=%s error=%s', runId, String(err));
    return null;
  }
}
