/**
 * 工作流运行态查询客户端。
 *
 * 用于在 Claude scheduled-task 超时看门狗里轮询工作流的最终运行结果，
 * 以便在 Claude 进程被超时杀掉、任务仍由服务端继续执行的情况下，
 * 能够把工作流的最终产物/错误回传给钉钉收件人。
 *
 * 复用与 `WorkflowExecutionTracker` 一致的本地 clawx host API
 * (`GET /agent/v1/runs/{runId}`) 和 `workflowRunResponseToExecutionState`
 * 归一化逻辑，保证看门狗拿到的状态语义与 UI 一致。
 */
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { logger } from '../utils/logger';
import { PORTS } from '../utils/config';
import { getStoToken } from '../utils/auth-store';
import {
  type WorkflowRunApiPayload,
  type WorkflowExecutionResult,
  workflowRunResponseToExecutionState,
  isTerminalWorkflowRunStatus,
  type WorkflowRunStatus,
  resolveWorkflowArtifactUrl,
} from '../../shared/workflow-run-status';

export interface WorkflowRunStatusResult {
  /** 归一化后的运行态：pending / running / completed / failed / timeout / unknown */
  status: WorkflowRunStatus;
  /** 最终结果摘要（成功时来自 result.summary/output；失败时为 undefined，错误见 error）。 */
  summary?: string;
  /** 产物列表（含可外链的预览/下载 URL）。 */
  artifacts: Array<{ name: string; url: string; previewUrl?: string }>;
  /** 失败时的错误信息。 */
  error?: string;
  /** 是否已进入终态。 */
  terminal: boolean;
}

interface WorkflowRunEnvelope {
  success: boolean;
  data?: WorkflowRunApiPayload;
  errCode?: string | number;
  errMessage?: string;
}

/**
 * 查询工作流运行态。
 *
 * @param runId 本次运行的唯一 id（由服务端在触发工作流时返回）
 */
export async function fetchWorkflowRunStatus(runId: string): Promise<WorkflowRunStatusResult> {
  const token = await getStoToken();
  const headers: Record<string, string> = {
    'X-Trace-Id': `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  };
  if (token) headers.stoToken = token;

  const pollPath = `/agent/v1/runs/${runId}`;
  logger.info(`[WorkflowRunClient] >>> fetchStatus GET ${pollPath} runId=${runId}`);

  const res = await proxyAwareFetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}${pollPath}`, {
    timeoutMs: 10_000,
    headers,
  });
  const bodyText = await res.text();
  logger.info(
    `[WorkflowRunClient] <<< fetchStatus status=${res.status} body=${bodyText.slice(0, 500)}`,
  );

  if (!res.ok) {
    throw new Error(`工作流运行查询失败 (HTTP ${res.status}): ${bodyText.slice(0, 200)}`);
  }

  let envelope: WorkflowRunEnvelope;
  try {
    envelope = JSON.parse(bodyText) as WorkflowRunEnvelope;
  } catch {
    throw new Error(`工作流运行查询响应解析失败: ${bodyText.slice(0, 200)}`);
  }

  if (!envelope.success || !envelope.data) {
    throw new Error(
      envelope.errMessage || `工作流运行查询失败 (errCode=${envelope.errCode ?? 'unknown'})`,
    );
  }

  const state = workflowRunResponseToExecutionState(envelope.data);
  const result: WorkflowExecutionResult | undefined = state.result;
  const artifacts = (result?.artifacts ?? []).map((a) => ({
    name: a.name,
    url: resolveWorkflowArtifactUrl(a),
    previewUrl: a.previewUrl,
  }));

  return {
    status: state.status,
    summary: result?.summary,
    artifacts,
    error: state.error,
    terminal: isTerminalWorkflowRunStatus(state.status),
  };
}

/**
 * 轮询工作流运行态直到进入终态或超过最大等待时间。
 *
 * @returns 终态结果；若在 `maxWaitMs` 内未进入终态，返回当前最后一次拿到的状态（terminal=false）。
 */
export async function pollWorkflowRunUntilTerminal(
  runId: string,
  opts: { intervalMs?: number; maxWaitMs?: number } = {},
): Promise<WorkflowRunStatusResult> {
  const intervalMs = opts.intervalMs ?? 5_000;
  const maxWaitMs = opts.maxWaitMs ?? 120_000;

  const deadline = Date.now() + maxWaitMs;
  let last: WorkflowRunStatusResult = {
    status: 'unknown',
    artifacts: [],
    terminal: false,
  };

  while (Date.now() < deadline) {
    try {
      last = await fetchWorkflowRunStatus(runId);
    } catch (err) {
      logger.warn(
        `[WorkflowRunClient] fetchStatus error runId=${runId} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (last.terminal) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  logger.info(
    `[WorkflowRunClient] pollWorkflowRunUntilTerminal timed out runId=${runId} lastStatus=${last.status}`,
  );
  return last;
}
