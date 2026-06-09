/**
 * WorkflowExecutionTracker
 *
 * Main Process service that polls backend workflow execution status
 * and broadcasts state updates to Renderer via IPC.
 */
import { webContents } from 'electron';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { logger } from '../../utils/logger';
import { PORTS } from '../../utils/config';
import { getStoToken } from '../../utils/auth-store';
import type { WorkflowExecutionState } from '../../src/types/workflow';
import {
  normalizeWorkflowRunStatus,
  normalizeWorkflowStepStatus,
} from '../../src/lib/workflow-run-status';

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_DURATION_MS = 600_000; // 10 minutes
const MAX_TRACKED_EXECUTIONS = 50;
const COMPLETED_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ExecutionSession {
  runId: string;
  workflowId: string;
  sessionKey: string;
  agentId: string;
  state: WorkflowExecutionState;
  createdAt: number;
  updatedAt: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  failCount: number;
  lastStepSignature: string;
  lastStepChangeAt: number;
  stopRequested: boolean;
  pollCount: number;
}

const USER_FRIENDLY_ERRORS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /404/, message: '工作流执行记录不存在，可能已被清理' },
  { pattern: /500|502|503/, message: '服务器繁忙，请稍后重试' },
  { pattern: /ENOTFOUND|ECONNREFUSED/, message: '网络连接失败，请检查网络设置' },
  { pattern: /ECONNRESET|EPIPE/, message: '连接被重置，请稍后重试' },
  { pattern: /timeout|abort/i, message: '请求超时，请稍后重试' },
];

function toUserFriendlyError(error: string): string {
  for (const { pattern, message } of USER_FRIENDLY_ERRORS) {
    if (pattern.test(error)) return message;
  }
  return `执行异常：${error.split(':')[0].trim()}`;
}

class WorkflowExecutionTracker {
  private sessions = new Map<string, ExecutionSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.periodicCleanup(), 60_000);
  }

  startTracking(runId: string, sessionKey: string, agentId: string, workflowId: string) {
    if (this.sessions.has(runId)) {
      logger.warn(`[Tracker] Run ${runId} is already being tracked`);
      return;
    }

    if (this.sessions.size >= MAX_TRACKED_EXECUTIONS) {
      this.evictOldestCompleted();
    }

    const now = Date.now();
    const session: ExecutionSession = {
      runId,
      workflowId,
      sessionKey,
      agentId,
      state: {
        runId,
        workflowId,
        status: 'pending',
        progress: 0,
        steps: [],
      },
      createdAt: now,
      updatedAt: now,
      pollTimer: null,
      failCount: 0,
      lastStepSignature: '',
      lastStepChangeAt: now,
      stopRequested: false,
      pollCount: 0,
    };

    this.sessions.set(runId, session);
    logger.info(`[workflow-trace] workflow:startTracking runId=${runId} workflowId=${workflowId} sessionKey=${sessionKey}`);
    logger.info(`[Tracker] Started tracking run ${runId}`);
    void this.bootstrapTracking(session);
  }

  stopTracking(runId: string) {
    const session = this.sessions.get(runId);
    if (!session) return;

    session.stopRequested = true;
    if (session.pollTimer) {
      clearInterval(session.pollTimer);
      session.pollTimer = null;
    }
    this.sessions.delete(runId);
    logger.info(`[Tracker] Stopped tracking run ${runId}`);
  }

  getState(runId: string): WorkflowExecutionState | null {
    return this.sessions.get(runId)?.state ?? null;
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [id] of this.sessions) {
      this.stopTracking(id);
    }
  }

  private async bootstrapTracking(session: ExecutionSession) {
    await this.poll(session);
    if (session.stopRequested) return;

    const status = session.state.status;
    if (status === 'completed' || status === 'failed' || status === 'timeout') {
      logger.info(`[Tracker] Run ${session.runId} already terminal (${status}), skip polling`);
      return;
    }

    this.beginPollingInterval(session);
  }

  private beginPollingInterval(session: ExecutionSession) {
    if (session.pollTimer) return;

    session.pollTimer = setInterval(() => {
      if (session.stopRequested) return;

      if (Date.now() - session.createdAt > MAX_POLL_DURATION_MS) {
        this.handleStateChange(session, {
          ...session.state,
          status: 'timeout',
          error: '执行超时（超过10分钟）',
        });
        this.stopTracking(session.runId);
        return;
      }

      void this.poll(session);
    }, POLL_INTERVAL_MS);
  }

  private beginPolling(session: ExecutionSession) {
    void this.bootstrapTracking(session);
  }

  private async poll(session: ExecutionSession) {
    try {
      let data: WorkflowExecutionState;

      const token = await getStoToken();
      const headers: Record<string, string> = {
        'X-Trace-Id': `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      };
      if (token) headers.stoToken = token;

      session.pollCount += 1;
      const pollPath = `/agent/v1/runs/${session.runId}`;
      const res = await proxyAwareFetch(
        `http://127.0.0.1:${PORTS.CLAWX_HOST_API}${pollPath}`,
        { timeoutMs: 10_000, headers },
      );
      if (session.pollCount === 1) {
        logger.info(`[workflow-trace] GET ${pollPath} poll #1 status=${res.status}`);
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const apiRes = (await res.json()) as { success: boolean; data?: {
        id: string;
        workflowId: string;
        status: string;
        nodeRuns: Array<{ id: string; nodeId: string; status: string; startedAt?: string; completedAt?: string; error?: string }>;
        artifacts: Array<{ id: string; name: string; type: string; url: string; size?: number }>;
        output?: unknown;
        result?: { title?: string | null; summary?: string | null };
        error?: string | null;
        startedAt: string;
        completedAt?: string | null;
      } };
      if (!apiRes.success || !apiRes.data) {
        throw new Error('API error');
      }
      const run = apiRes.data;
      const status = normalizeWorkflowRunStatus(run.status);
      logger.info(
        `[workflow-trace] GET ${pollPath} poll #${session.pollCount} runId=${session.runId} apiStatus=${run.status} uiStatus=${status} progress=${run.nodeRuns.filter((n) => normalizeWorkflowStepStatus(n.status) === 'completed').length}/${run.nodeRuns.length || 1} completedAt=${run.completedAt ?? 'null'} hasResult=${Boolean(run.result?.summary || run.result?.title)} artifactCount=${run.artifacts?.length ?? 0}`,
      );
      const totalNodes = run.nodeRuns.length || 1;
      const completedNodes = run.nodeRuns.filter(
        (n) => normalizeWorkflowStepStatus(n.status) === 'completed',
      ).length;
      const progress = status === 'completed' ? 100 : Math.min(99, Math.floor((completedNodes / totalNodes) * 100));
      const artifacts = run.artifacts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        url: a.url,
        size: a.size,
      }));
      const summary = run.result?.summary ?? run.result?.title
        ?? (typeof run.output === 'string' ? run.output : undefined);

      data = {
        runId: run.id,
        workflowId: run.workflowId,
        status,
        progress,
        currentStep: run.nodeRuns.find((n) => normalizeWorkflowStepStatus(n.status) === 'running')?.nodeId,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? undefined,
        steps: run.nodeRuns.map((n) => ({
          name: n.nodeId,
          status: normalizeWorkflowStepStatus(n.status),
          duration: n.startedAt && n.completedAt
            ? new Date(n.completedAt).getTime() - new Date(n.startedAt).getTime()
            : undefined,
          error: n.error,
        })),
        result: summary || artifacts.length > 0
          ? { summary, artifacts: artifacts.length > 0 ? artifacts : undefined }
          : undefined,
        error: run.error ?? undefined,
      };

      session.failCount = 0;

      // Stall detection
      const stepSignature = JSON.stringify(data.steps);
      if (stepSignature === session.lastStepSignature) {
        if (Date.now() - session.lastStepChangeAt > 30_000 && data.status === 'running') {
          logger.warn(`[Tracker] ${session.runId} stalled, no step change for 30s`);
        }
      } else {
        session.lastStepSignature = stepSignature;
        session.lastStepChangeAt = Date.now();
      }

      this.handleStateChange(session, data);
    } catch (err) {
      const errStr = String(err);
      session.failCount++;

      // 404 → immediate fail
      if (errStr.includes('404') || (err as { status?: number }).status === 404) {
        this.handleStateChange(session, {
          ...session.state,
          status: 'failed',
          error: toUserFriendlyError('404'),
        });
        this.stopTracking(session.runId);
        return;
      }

      // Retry with exponential backoff
      if (session.failCount <= 3) {
        const backoff = Math.min(2000 * Math.pow(2, session.failCount - 1), 30000);
        logger.warn(`[Tracker] Poll failed #${session.failCount} for ${session.runId}, retry in ${backoff}ms`);
        // Temporarily stop interval polling, resume after backoff
        if (session.pollTimer) {
          clearInterval(session.pollTimer);
          session.pollTimer = null;
        }
        setTimeout(() => {
          if (!session.stopRequested) {
            this.beginPolling(session);
          }
        }, backoff);
        return;
      }

      // Max retries exceeded
      this.handleStateChange(session, {
        ...session.state,
        status: 'failed',
        error: toUserFriendlyError(errStr),
      });
      this.stopTracking(session.runId);
    }
  }

  private handleStateChange(session: ExecutionSession, newState: WorkflowExecutionState) {
    const prevStatus = session.state.status;
    const prevProgress = session.state.progress;

    session.state = newState;
    session.updatedAt = Date.now();

    // Determine if we should broadcast
    const statusChanged = prevStatus !== newState.status;
    const stepChanged = JSON.stringify(session.lastStepSignature) !== JSON.stringify(newState.steps);
    const significantProgress =
      newState.status === 'running' &&
      Math.floor(newState.progress / 10) !== Math.floor(prevProgress / 10);

    if (statusChanged) {
      logger.info(
        `[workflow-trace] run status change runId=${session.runId} ${prevStatus} -> ${newState.status} progress=${newState.progress}`,
      );
    }

    if (statusChanged || stepChanged || significantProgress || newState.status === 'completed' || newState.status === 'failed') {
      this.broadcastState(session);
    }

    // Terminal states → stop tracking after a short delay
    if (newState.status === 'completed' || newState.status === 'failed' || newState.status === 'timeout') {
      if (session.pollTimer) {
        clearInterval(session.pollTimer);
        session.pollTimer = null;
      }
      // Keep in Map for sync-state, cleanup timer will remove later
      logger.info(`[Tracker] Run ${session.runId} finished with status: ${newState.status}`);
    }
  }

  private broadcastState(session: ExecutionSession) {
    const payload = {
      runId: session.runId,
      sessionKey: session.sessionKey,
      ...session.state,
    };

    for (const wc of webContents.getAllWebContents()) {
      wc.send('workflow:status-update', payload);
    }
  }

  private evictOldestCompleted() {
    const completed = Array.from(this.sessions.values())
      .filter((s) => s.state.status === 'completed' || s.state.status === 'failed' || s.state.status === 'timeout')
      .sort((a, b) => a.updatedAt - b.updatedAt);

    while (this.sessions.size >= MAX_TRACKED_EXECUTIONS && completed.length > 0) {
      const oldest = completed.shift()!;
      this.stopTracking(oldest.runId);
    }
  }

  private periodicCleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      const isTerminal = session.state.status === 'completed' || session.state.status === 'failed' || session.state.status === 'timeout';
      if (isTerminal && now - session.updatedAt > COMPLETED_TTL_MS) {
        this.stopTracking(id);
      }
    }
  }
}

// Singleton instance
let trackerInstance: WorkflowExecutionTracker | null = null;

export function getWorkflowExecutionTracker(): WorkflowExecutionTracker {
  if (!trackerInstance) {
    trackerInstance = new WorkflowExecutionTracker();
  }
  return trackerInstance;
}

export function destroyWorkflowExecutionTracker(): void {
  if (trackerInstance) {
    trackerInstance.destroy();
    trackerInstance = null;
  }
}
