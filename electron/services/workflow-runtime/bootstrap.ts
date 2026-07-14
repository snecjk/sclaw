/**
 * workflow-runtime 生产接线工厂（A+B 之 B：注入真实依赖）。
 *
 * 把 engine 需要的 4 个生产依赖接通：
 * - invokeAgent：绑真实 @anthropic-ai/claude-agent-sdk 的 query（复用 agent-runner），
 *   env 复用 buildClaudeEnvForAccount（鉴权同聊天），排除全部 5 runtime 扩展。
 * - postSync：proxyAwareFetch POST /agent/v2/runs/{id}/sync + buildStoMemoryCenterAuthHeaders。
 * - dslClient.fetchVersion：GET /agent/v2/workflows/{id}/versions/{vid}。
 * - onRecover：广播到所有 renderer 窗口，由 UI 弹"续跑/重发"对话框。
 *
 * quota 暂默认 true（配额门留 TODO：MC 端 quota 端点路径待确认后接 /api/token-quota/check）。
 */
import { BrowserWindow } from 'electron';
import { getStoToken } from '../../utils/auth-store';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { buildStoMemoryCenterAuthHeaders } from '../../utils/sto-memory-api-auth';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { invokeAgent as agentRunnerInvokeAgent } from './agent-runner';
import { getWorkflowRuntimeRepository } from '../../db';
import type { EngineDeps } from './engine';

let cachedSdk: any = null;
async function getSdk(): Promise<any> {
  if (!cachedSdk) cachedSdk = await import('@anthropic-ai/claude-agent-sdk');
  return cachedSdk;
}

async function authedFetch(path: string, init: { method: string; body?: any }): Promise<any> {
  const baseUrl = await resolveStoBaseUrl();
  const token = await getStoToken();
  if (!token) throw Object.assign(new Error('stoToken missing'), { status: 401 });
  const res = await proxyAwareFetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: { 'Content-Type': 'application/json', ...buildStoMemoryCenterAuthHeaders(token) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) throw Object.assign(new Error('stoToken expired'), { status: 401 });
  if (!res.ok) throw new Error(`workflow v2 ${init.method} ${path} -> ${res.status}`);
  return res.json();
}

export function createWorkflowRuntimeEngineDeps(): EngineDeps {
  return {
    repo: getWorkflowRuntimeRepository(),
    invokeAgent: async (args) => {
      const sdk = await getSdk();
      return agentRunnerInvokeAgent({ sdk, ctx: { ...args.ctx, nodeId: args.nodeId }, prompt: args.prompt });
    },
    postSync: async (runId, entries) => authedFetch(`/agent/v2/runs/${runId}/sync`, { method: 'POST', body: { entries } }),
    dslClient: {
      fetchVersion: async (workflowId: string, versionId: string) =>
        authedFetch(`/agent/v2/workflows/${workflowId}/versions/${versionId}`, { method: 'GET' }),
    } as any,
    onRecover: (runs) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('workflow-runtime:recover', runs);
      }
    },
    onTokenExpired: () => {
      // outbox-flusher 遇 401 时广播（auth-store 已有 token-expired 广播机制，此处兜底）
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('auth:token-expired');
    },
    // quota: TODO 接 /api/token-quota/check（MC 端路径确认后补）；暂默认放行
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
