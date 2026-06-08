/**
 * Workflow API Client
 *
 * Aligned with Agent Workflow Client API v1.
 * All endpoints return { success, data, traceId } and require stoToken header.
 */
import { hostApiFetch, hostApiFetchStream } from '@/lib/host-api';
import type {
  ApiResponse,
  WorkflowTemplateSearchResponse,
  StartupSchemaResponse,
  CreateWorkflowRequest,
  CreateWorkflowResponse,
  StartWorkflowRequest,
  WorkflowRunResponse,
  WorkflowExecutionState,
} from '@/types/workflow';

/** Extract stoToken from auth store (sync read) */
function getStoToken(): string | undefined {
  try {
    const raw = localStorage.getItem('stoclaw-auth');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { state?: { user?: { stoToken?: string } } };
    return parsed?.state?.user?.stoToken;
  } catch {
    return undefined;
  }
}

function generateTraceId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function authHeaders(): Record<string, string> {
  const token = getStoToken();
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

// ── 1. Search templates ─────────────────────────────────────────

export async function searchWorkflowTemplates(query: string, limit = 3): Promise<WorkflowTemplateSearchResponse> {
  const data = await unwrap(
    hostApiFetch<ApiResponse<WorkflowTemplateSearchResponse>>('/agent/v1/workflow-templates/search', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query, limit }),
    }),
  );
  return data;
}

// ── 2. Get startup schema ───────────────────────────────────────

export async function getStartupSchema(templateId: string): Promise<StartupSchemaResponse> {
  const data = await unwrap(
    hostApiFetch<ApiResponse<StartupSchemaResponse>>(`/agent/v1/workflow-templates/${templateId}/startup-schema`, {
      headers: authHeaders(),
    }),
  );
  return data;
}

// ── 3. Create workflow ──────────────────────────────────────────

export async function createWorkflow(params: CreateWorkflowRequest): Promise<CreateWorkflowResponse> {
  const init: RequestInit = {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
  };
  const data = await unwrap(
    hostApiFetch<ApiResponse<CreateWorkflowResponse>>('/agent/v1/workflows', init),
  );
  return data;
}

// ── 4. Start workflow ───────────────────────────────────────────

export async function startWorkflow(
  workflowId: string,
  params: StartWorkflowRequest,
): Promise<WorkflowRunResponse> {
  const init: RequestInit = {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
  };
  const data = await unwrap(
    hostApiFetch<ApiResponse<WorkflowRunResponse>>(`/agent/v1/workflows/${workflowId}/start`, init),
  );
  return data;
}

// ── 5. Get run status ───────────────────────────────────────────

export async function getWorkflowRun(runId: string): Promise<WorkflowRunResponse> {
  const data = await unwrap(
    hostApiFetch<ApiResponse<WorkflowRunResponse>>(`/agent/v1/runs/${runId}`, {
      headers: authHeaders(),
    }),
  );
  return data;
}

// ── Helper: convert WorkflowRunResponse to UI execution state ───

export function runToExecutionState(run: WorkflowRunResponse): WorkflowExecutionState {
  const totalNodes = run.nodeRuns.length || 1;
  const completedNodes = run.nodeRuns.filter((n) => n.status === 'completed').length;
  const progress = run.status === 'completed' ? 100 : Math.min(99, Math.floor((completedNodes / totalNodes) * 100));

  return {
    runId: run.id,
    workflowId: run.workflowId,
    status: run.status,
    progress,
    currentStep: run.nodeRuns.find((n) => n.status === 'running')?.nodeId,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? undefined,
    steps: run.nodeRuns.map((n) => ({
      name: n.nodeId,
      status: n.status as WorkflowExecutionState['steps'][number]['status'],
      duration: n.startedAt && n.completedAt
        ? new Date(n.completedAt).getTime() - new Date(n.startedAt).getTime()
        : undefined,
      error: n.error,
    })),
    result: run.status === 'completed' && run.output
      ? {
          summary: typeof run.output === 'string' ? run.output : undefined,
          artifacts: run.artifacts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            url: a.url,
            size: a.size,
          })),
        }
      : undefined,
    error: run.error ?? undefined,
  };
}

// ── 6. Subscribe to run stream (SSE) ────────────────────────────

/**
 * Subscribe to real-time workflow run updates via SSE.
 * Returns an unsubscribe function to stop the stream and clean up.
 */
export function subscribeWorkflowRun(
  runId: string,
  onEvent: (data: WorkflowRunResponse) => void,
  onError?: (error: Error) => void,
): () => void {
  const abort = new AbortController();
  let closed = false;

  const connect = async () => {
    try {
      const response = await hostApiFetchStream(`/agent/v1/runs/${runId}/stream`, {
        headers: authHeaders(),
        signal: abort.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

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
              try {
                onEvent(JSON.parse(currentData) as WorkflowRunResponse);
              } catch (e) {
                onError?.(new Error(`SSE parse error: ${String(e)}`));
              }
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }
    } catch (err) {
      if (closed || abort.signal.aborted) return; // Intentional close
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
    }
  };

  // Start the stream in the background
  void connect();

  return () => {
    closed = true;
    abort.abort();
  };
}

// ── Legacy compatibility: query execution status (fallback) ─────

export async function fetchWorkflowStatus(runId: string): Promise<WorkflowExecutionState | null> {
  try {
    const run = await getWorkflowRun(runId);
    return runToExecutionState(run);
  } catch {
    return null;
  }
}
