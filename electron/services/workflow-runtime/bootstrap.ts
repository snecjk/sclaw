/**
 * workflow-runtime 生产接线工厂（A+B 之 B：注入真实依赖）。
 *
 * 把 engine 需要的 4 个生产依赖接通：
 * - invokeAgent：绑真实 @anthropic-ai/claude-agent-sdk 的 query（复用 agent-runner），
 *   env 复用 buildClaudeEnvForAccount（鉴权同聊天），排除全部 5 runtime 扩展。
 * - postSync：proxyAwareFetch POST /agent/v2/runs/{id}/sync + buildStoMemoryCenterAuthHeaders。
 * - dslClient.fetchVersion：GET /agent/v2/workflows/getVersion/{version_pk}。
 * - onRecover：广播到所有 renderer 窗口，由 UI 弹"续跑/重发"对话框。
 *
 * - quota：复用聊天日额度门 StoTokenQuotaService（后端 /agent/v1/token-quota/check）。
 */
import { BrowserWindow } from 'electron';
import { getStoToken } from '../../utils/auth-store';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { buildStoMemoryCenterAuthHeaders } from '../../utils/sto-memory-api-auth';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getStoTokenQuotaService } from '../sto-token-quota-service';
import { getOpenClawProvidersConfig } from '../../utils/openclaw-auth';
import { invokeAgent as agentRunnerInvokeAgent } from './agent-runner';
import { getWorkflowRuntimeRepository } from '../../db';
import type { EngineDeps } from './engine';
import type { WorkflowRunStatus } from '../../../shared/workflow-run-status';
import { workflowExecLog } from './logging';
import { configureWorkflowIdPool } from './id-pool';
import { runWorkspacePath, workspacePath } from './workspace-paths';

let cachedSdk: any = null;
let cachedWorkflowModel: string | undefined;
async function getSdk(): Promise<any> {
  if (!cachedSdk) cachedSdk = await import('@anthropic-ai/claude-agent-sdk');
  return cachedSdk;
}

/**
 * Workflow definitions may contain server-side aliases (for example "sonnet"),
 * which are not model ids available to the local Claude SDK proxy.  Use the
 * application's currently selected provider model instead.
 */
async function getConfiguredWorkflowModel(): Promise<string | undefined> {
  if (cachedWorkflowModel) return cachedWorkflowModel;
  const { defaultModel } = await getOpenClawProvidersConfig();
  const model = defaultModel?.trim().split('/').pop()?.trim();
  if (model) cachedWorkflowModel = model;
  return model;
}

/** 带鉴权的后端 v2 调用：resolveStoBaseUrl + getStoToken + buildStoMemoryCenterAuthHeaders + proxyAwareFetch。
 * 401 抛错（由 onTokenExpired 兜底），非 2xx 抛错。供 engine postSync/dslClient 及主进程内
 * 同进程调用（loopback HTTP 本地路由 /agent/v2/workflows/:id/createRunLog 子调用后端注册 run）复用。 */
export async function workflowV2BackendFetch(
  path: string,
  init: { method: string; body?: any; stoToken?: string },
): Promise<any> {
  const baseUrl = await resolveStoBaseUrl();
  const token = init.stoToken?.trim() || await getStoToken();
  if (!token) throw Object.assign(new Error('stoToken missing'), { status: 401 });
  const res = await proxyAwareFetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: { 'Content-Type': 'application/json', ...buildStoMemoryCenterAuthHeaders(token) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) throw Object.assign(new Error('stoToken expired'), { status: 401 });
  if (!res.ok) {
    let message = `workflow v2 ${init.method} ${path} -> ${res.status}`;
    try {
      const payload = await res.json() as { errMessage?: string; detail?: string };
      message = payload.errMessage || payload.detail || message;
    } catch {
      // Keep the status-based message when the backend did not return JSON.
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  return res.json();
}

export function createWorkflowRuntimeEngineDeps(): EngineDeps {
  configureWorkflowIdPool(async (count) => {
    const response = await workflowV2BackendFetch('/agent/v2/ids/allocate', { method: 'POST', body: { count } });
    if (!Array.isArray(response?.ids)) throw new Error('global workflow id response missing ids');
    return response.ids.map((id: unknown) => Number(id));
  });
  return {
    repo: getWorkflowRuntimeRepository(),
    invokeAgent: async (args) => {
      const sdk = await getSdk();
      return agentRunnerInvokeAgent({
        sdk,
        ctx: { ...args.ctx, nodeId: args.nodeId },
        prompt: args.prompt,
        cwd: workspacePath(args.ctx.runId, args.nodeId),
        additionalDirectories: [runWorkspacePath(args.ctx.runId)],
        noProgressMs: (args as any).noProgressMs,
        deadlineMs: (args as any).deadlineMs,
        // Keep the complete DSL model reference.  The shared Claude runtime
        // resolves it against the account catalog, just as chat does; stripping
        // its provider prefix here turns a valid reference into an invalid one.
        model: args.model && !['sonnet', 'haiku', 'opus'].includes(args.model)
          ? args.model
          : await getConfiguredWorkflowModel(),
        onStreamEvent: args.onStreamEvent,
        allowedTools: args.allowedTools,
        allowedSkills: args.allowedSkills,
        permissionMode: args.permissionMode,
        outputSchema: args.outputSchema,
      });
    },
    postSync: async (runId, entries) => {
      workflowExecLog('debug', 'sync-post', 'posting outbox entries to backend', { runId, entryCount: entries.length });
      return workflowV2BackendFetch(`/agent/v2/runs/${runId}/sync`, { method: 'POST', body: { entries } });
    },
    dslClient: {
      fetchVersion: async (workflowId: string, versionId: string) => {
        workflowExecLog('info', 'dsl-fetch', 'fetching workflow version definition', { workflowId, versionId });
        const version = await workflowV2BackendFetch(`/agent/v2/workflows/getVersion/${versionId}`, { method: 'GET' });
        workflowExecLog('info', 'dsl-fetch', 'workflow version definition fetched', { workflowId, versionId });
        return version;
      },
    } as any,
    quota: async () => {
      const result = await getStoTokenQuotaService().checkTokenQuota();
      const data = result.data as Record<string, unknown>;
      if (data.allowed === false) return false;
      const remaining = typeof data.remaining === 'number' ? data.remaining : undefined;
      return result.success && (remaining === undefined || remaining > 0);
    },
    onRecover: (runs) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('workflow-runtime:recover', runs);
      }
    },
    onEvent: (runId, event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('workflow:event', { runId, ...event });
      }
    },
    /** gap2 状态转换桥：engine dispatch 4 个转换点 + crash-recovery 调用此回调。
     * bootstrap 读 run 行拿 session_key（透传 payload 给 renderer 按 sessionKey 过滤），
     * 状态按 shared/normalizeWorkflowRunStatus 归一化（DB 大写枚举 → UI 小写），
     * 复用 renderer 已监听的 'workflow:status-update' 通道（与 poll 路径同构）。 */
    onStatusChange: (runId, status, extra) => {
      const repo = getWorkflowRuntimeRepository();
      void (async () => {
        let sessionKey = '';
        try {
          const row = await repo.getRun(runId);
          sessionKey = row?.session_key ?? '';
        } catch { /* run 行缺失时退化为无 sessionKey，renderer 侧按 sessionKey 过滤会自然丢弃 */ }
        const payload: {
          runId: string; sessionKey: string; status: WorkflowRunStatus;
          waitingNodeId?: string; error?: string;
        } = { runId, sessionKey, status };
        if (extra?.waitingNodeId) payload.waitingNodeId = extra.waitingNodeId;
        if (extra?.error) payload.error = extra.error;
        workflowExecLog('info', 'status-change', 'broadcast workflow status', {
          runId,
          sessionKey,
          status,
          waitingNodeId: extra?.waitingNodeId,
          error: extra?.error,
        });
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send('workflow:status-update', payload);
        }
      })();
    },
    onTokenExpired: () => {
      // outbox-flusher 遇 401 时广播（auth-store 已有 token-expired 广播机制，此处兜底）
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('auth:token-expired');
    },
  };
}

import { registerWorkflowRuntimeHandlers, type RuntimeHandlers } from './index';

let _handlers: RuntimeHandlers | null = null;

/** 在 registerIpcHandlers 中调用：注册 workflow-runtime IPC 通道。 */
export function installWorkflowRuntime(): RuntimeHandlers {
  if (_handlers) return _handlers;
  _handlers = registerWorkflowRuntimeHandlers(createWorkflowRuntimeEngineDeps());
  return _handlers;
}

/** 在主进程 ready + SQLite 初始化后调用：收口在途 run + 起 outbox flushLoop。 */
export function startWorkflowRuntimeOnLaunch(): void {
  if (!_handlers) return;
  void _handlers.recover();     // CrashRecovery：在途 run 标 INTERRUPTED + 同步终态 + 广播 onRecover
  _handlers.startSync();        // OutboxFlusher：起异步推送循环（FIFO + 退避 + 401）
}
