/**
 * workflow-runtime 生产接线工厂（A+B 之 B：注入真实依赖）。
 *
 * 把 engine 需要的 4 个生产依赖接通：
 * - invokeAgent：绑真实 @anthropic-ai/claude-agent-sdk 的 query（复用 agent-runner-claude），
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
import { invokeAgent as agentRunnerInvokeAgent } from './agent-runner-claude';
import { invokeOpenClawWorkflowAgent, releaseOpenClawWorkflowAgentSession } from './agent-runner-openclaw';
import { invokePiWorkflowAgent, releasePiWorkflowAgentSession } from './agent-runner-pi';
import type { GatewayManager } from '../../gateway/manager';
import { getWorkflowRuntimeRepository } from '../../db';
import { ScheduleTaskRunRepository } from '../../db/repositories/schedule-task-run-repository';
import type { EngineDeps } from './engine';
import type { WorkflowRunStatus } from '../../../shared/workflow-run-status';
import { workflowExecLog } from './logging';
import { configureWorkflowIdPool } from './id-pool';
import { runWorkspacePath, workspacePath } from './workspace-paths';
import { notifyWorkflowCompletion } from './completion-notification';

let cachedSdk: any = null;
async function getSdk(): Promise<any> {
  if (!cachedSdk) cachedSdk = await import('@anthropic-ai/claude-agent-sdk');
  return cachedSdk;
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

export function createWorkflowRuntimeEngineDeps(
  gatewayManager?: GatewayManager,
  getMainWindow?: () => BrowserWindow | null,
): EngineDeps {
  const scheduleTaskRunRepo = new ScheduleTaskRunRepository();
  configureWorkflowIdPool(async (count) => {
    const response = await workflowV2BackendFetch('/agent/v2/ids/allocate', { method: 'POST', body: { count } });
    if (!Array.isArray(response?.ids)) throw new Error('global workflow id response missing ids');
    return response.ids.map((id: unknown) => Number(id));
  });
  return {
    repo: getWorkflowRuntimeRepository(),
    isScheduledTaskSession: (sessionKey) => scheduleTaskRunRepo.existsBySessionKey(sessionKey),
    invokeAgent: async (args) => {
      const run = await getWorkflowRuntimeRepository().getRun(args.ctx.runId);
      // Chat persists its selected model on the session before a workflow starts.
      // Prefer that pinned run model; only non-chat runs may use the DSL model.
      const effectiveModel = run?.engine_model?.trim() || args.model?.trim();
      if (!effectiveModel) {
        throw new Error('Workflow execution model is missing');
      }
      const execEngine = run?.engine_type === 'openclaw'
        ? 'openclaw'
        : run?.engine_type === 'claude' ? 'claude' : 'pi';
      const persistActualModel = async (model: string): Promise<void> => {
        await getWorkflowRuntimeRepository().updateRunIfActive(args.ctx.runId, { engine_model: model });
        workflowExecLog('info', 'agent-model-selected', 'workflow agent model resolved', {
          runId: args.ctx.runId,
          nodeId: args.nodeId,
          execEngine,
          model,
        });
      };
      if (run?.engine_type === 'openclaw') {
        if (!gatewayManager) throw new Error('OpenClaw workflow gateway unavailable');
        if (!args.agentSessionId) throw new Error('OpenClaw workflow node session is required');
        await persistActualModel(effectiveModel);
        return invokeOpenClawWorkflowAgent({ gateway: gatewayManager, ctx: { ...args.ctx, nodeId: args.nodeId }, prompt: args.prompt,
          attempt: args.attempt, model: effectiveModel,
          agentSessionId: args.agentSessionId, resumeSession: args.resumeSession,
          noProgressMs: (args as any).noProgressMs, deadlineMs: (args as any).deadlineMs, onStreamEvent: args.onStreamEvent });
      }
      if (run?.engine_type === 'pi') {
        if (!args.agentSessionId) throw new Error('SAgent workflow node session is required');
        await persistActualModel(effectiveModel);
        return invokePiWorkflowAgent({
          ctx: { ...args.ctx, nodeId: args.nodeId },
          prompt: args.prompt,
          model: effectiveModel,
          agentSessionId: args.agentSessionId,
          originSessionKey: run.session_key ?? '',
          cwd: workspacePath(args.ctx.runId, args.nodeId),
          noProgressMs: (args as any).noProgressMs,
          deadlineMs: (args as any).deadlineMs,
          onStreamEvent: args.onStreamEvent,
        });
      }
      const sdk = await getSdk();
      return agentRunnerInvokeAgent({
        sdk,
        ctx: { ...args.ctx, nodeId: args.nodeId },
        prompt: args.prompt,
        cwd: workspacePath(args.ctx.runId, args.nodeId),
        additionalDirectories: [runWorkspacePath(args.ctx.runId)],
        noProgressMs: (args as any).noProgressMs,
        deadlineMs: (args as any).deadlineMs,
        model: effectiveModel,
        onModelResolved: persistActualModel,
        onStreamEvent: args.onStreamEvent,
        allowedTools: args.allowedTools,
        permissionMode: args.permissionMode,
        outputSchema: args.outputSchema,
        execEngine: 'claude',
        agentSessionId: args.agentSessionId,
        resumeSession: args.resumeSession,
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
    releaseAgentSession: async (runId, nodeSessionId) => {
      if (!nodeSessionId) return;
      const run = await getWorkflowRuntimeRepository().getRun(runId);
      if (run?.engine_type === 'openclaw') {
        await releaseOpenClawWorkflowAgentSession(nodeSessionId);
        return;
      }
      if (run?.engine_type === 'pi') {
        await releasePiWorkflowAgentSession(nodeSessionId);
        return;
      }
      const sdk = await getSdk();
      if (typeof sdk.deleteSession === 'function') await sdk.deleteSession(nodeSessionId);
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
        let runRow: {
          session_key?: string | null;
          workflow_id?: string;
          last_agent_raw_text?: string | null;
          started_at?: string;
          completed_at?: string | null;
        } | undefined;
        try {
          runRow = await repo.getRun(runId);
          sessionKey = runRow?.session_key ?? '';
        } catch { /* run 行缺失时退化为无 sessionKey，renderer 侧按 sessionKey 过滤会自然丢弃 */ }
        const nodeRuns = runRow ? await repo.listNodeRuns(runId).catch(() => []) : [];
        const completedNodes = nodeRuns.filter((node: any) => ['SUCCEEDED', 'COMPLETED', 'SUCCESS'].includes(String(node.status).toUpperCase())).length;
        const activeNode = nodeRuns.find((node: any) => String(node.status).toUpperCase() === 'RUNNING');
        const totalNodes = Math.max(nodeRuns.length, 1);
        const payload: {
          runId: string; sessionKey: string; status: WorkflowRunStatus;
          waitingNodeId?: string; error?: string;
          progress?: number; currentNodeId?: string; attempt?: number;
          startedAt?: string; completedAt?: string;
        } = {
          runId,
          sessionKey,
          status,
          progress: status === 'completed' ? 100 : Math.min(99, Math.floor((completedNodes / totalNodes) * 100)),
          currentNodeId: activeNode?.node_id,
          attempt: activeNode?.attempt_count,
          startedAt: runRow?.started_at,
          completedAt: runRow?.completed_at ?? undefined,
        };
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
        notifyWorkflowCompletion(
          getMainWindow?.() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null,
          {
            runId,
            sessionKey,
            status,
            workflowName: runRow?.workflow_id,
            summary: typeof runRow?.last_agent_raw_text === 'string' ? runRow.last_agent_raw_text.slice(0, 120) : undefined,
            error: extra?.error,
          },
        );
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
export function installWorkflowRuntime(
  gatewayManager?: GatewayManager,
  getMainWindow?: () => BrowserWindow | null,
): RuntimeHandlers {
  if (_handlers) return _handlers;
  _handlers = registerWorkflowRuntimeHandlers(createWorkflowRuntimeEngineDeps(gatewayManager, getMainWindow));
  return _handlers;
}

/** Read the installed singleton without allowing a status request to initialize it early. */
export function getInstalledWorkflowRuntime(): RuntimeHandlers | null {
  return _handlers;
}

/** 在主进程 ready + SQLite 初始化后调用：收口在途 run + 起 outbox flushLoop。 */
export function startWorkflowRuntimeOnLaunch(): void {
  if (!_handlers) return;
  void _handlers.recover();     // CrashRecovery：在途 run 标 INTERRUPTED + 同步终态 + 广播 onRecover
  _handlers.startSync();        // OutboxFlusher：起异步推送循环（FIFO + 退避 + 401）
}
