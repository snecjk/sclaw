/**
 * OpenClaw transport for workflow smart nodes.  It deliberately talks to a
 * dedicated agent with an empty, non-bootstrap workspace: workflow prompt
 * semantics therefore come solely from prompt-builder.ts.
 */
import type { GatewayManager } from '../../gateway/manager';
import { createAgentWithId } from '../../utils/agent-config';
import { extractJsonFromText } from './agent-output';
import type { AgentStreamEvent, InvokeResult } from './agent-runner-claude';
import { workflowExecLog } from './logging';
import { ensureWorkflowRuntimeTemplates, workflowRuntimeWorkspacePath } from './openclaw-workspace-template';
import { cleanupWorkflowOpenClawSession } from './openclaw-workflow-session-cleanup';
import { isWorkflowPacket } from './workflow-packet';
import { workflowGatewaySessionKey } from './node-session';
import { prepareWorkflowSkills } from './skill-loader';
import {
  WORKFLOW_AGENT_HARD_DEADLINE_MS,
  WORKFLOW_AGENT_NO_PROGRESS_TIMEOUT_MS,
} from '../../../shared/workflow-agent-timeouts';

const AGENT_ID = 'workflow-runtime';
const activeSessions = new Map<string, { gateway: GatewayManager; sessionKey: string; runId?: string }>();
const REPEATED_OUTPUT_MIN_CHARS = 32;
const REPEATED_OUTPUT_MAX_PERIOD = 512;
const REPEATED_OUTPUT_COUNT = 4;
export const OPENCLAW_RATE_LIMIT_MAX_RETRIES = 3;

export function openClawRateLimitRetryDelayMs(retryNumber: number): number {
  const normalizedRetry = Math.max(1, Math.trunc(retryNumber));
  return Math.min(30_000, 5_000 * 3 ** (normalizedRetry - 1));
}

export function isOpenClawRateLimitError(value: unknown): boolean {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return /(?:\b429\b|rate\s*limit|too many requests|请求过于频繁|请求频率过高)/i.test(text);
}

export function openClawRateLimitRetryMessage(retryNumber: number): string {
  return `模型服务限流后的第 ${retryNumber}/${OPENCLAW_RATE_LIMIT_MAX_RETRIES} 次重试：请继续当前节点任务。先检查本会话中已有结果和文件，不要重复已完成的工具调用或副作用；完成后仅返回要求的完整 WorkflowPacket。`;
}

/** Ensure this agent uses only the versioned workflow-owned bootstrap files. */
export async function ensureWorkflowOpenClawAgent(options?: { syncSkills?: boolean }): Promise<void> {
  // Must happen before Gateway reload so its skill scan sees the same global
  // and active-user packages that ordinary OpenClaw chat sees.
  if (options?.syncSkills !== false) {
    await prepareWorkflowSkills(['openclaw']);
  }
  const workspace = workflowRuntimeWorkspacePath();
  const prepared = await ensureWorkflowRuntimeTemplates(workspace);
  workflowExecLog('info', 'openclaw-workspace-template', 'workflow runtime templates prepared', {
    templateVersion: prepared.templateVersion,
    createdFiles: prepared.createdFiles,
    updatedFiles: prepared.updatedFiles,
    removedFiles: prepared.removedFiles,
  });
  // The versioned template is reapplied below, so no unsupported OpenClaw
  // config flags are needed to keep this service workspace workflow-owned.
  await createAgentWithId(AGENT_ID, 'Workflow Runtime', { workspace });
  const verified = await ensureWorkflowRuntimeTemplates(workspace);
  if (verified.createdFiles.length || verified.updatedFiles.length || verified.removedFiles.length) {
    workflowExecLog('warn', 'openclaw-workspace-template', 'workflow runtime templates changed during agent registration and were repaired', {
      templateVersion: verified.templateVersion,
      createdFiles: verified.createdFiles,
      updatedFiles: verified.updatedFiles,
      removedFiles: verified.removedFiles,
    });
  }
}

/**
 * Provision the isolated workflow agent before the Gateway child process is
 * started. OpenClaw reads its agent registry during startup, so doing this at
 * launch time makes the runtime routable without restarting a live Gateway.
 */
export async function prepareWorkflowOpenClawRuntimeForGatewayLaunch(): Promise<void> {
  await ensureWorkflowOpenClawAgent();
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(messageText).join('');
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  if (typeof item.text === 'string') return item.text;
  if ('content' in item) return messageText(item.content);
  if ('message' in item) return messageText(item.message);
  return '';
}

/** Gateway chat deltas are cumulative snapshots for some OpenClaw engines. */
function mergeOpenClawStreamText(previous: string, next: string): string {
  return previous && next.startsWith(previous) ? next : previous + next;
}

/** Detect a repeated tail such as a model endlessly repeating the same tool instruction. */
export function findRepeatedOpenClawOutputPeriod(value: string): number | undefined {
  const text = value.replace(/\s+/g, ' ').trim();
  const maxPeriod = Math.min(REPEATED_OUTPUT_MAX_PERIOD, Math.floor(text.length / REPEATED_OUTPUT_COUNT));
  for (let period = REPEATED_OUTPUT_MIN_CHARS; period <= maxPeriod; period++) {
    const chunk = text.slice(-period);
    let repeated = true;
    for (let offset = 2; offset <= REPEATED_OUTPUT_COUNT; offset++) {
      if (text.slice(-period * offset, -period * (offset - 1)) !== chunk) {
        repeated = false;
        break;
      }
    }
    if (repeated) return period;
  }
  return undefined;
}

export async function invokeOpenClawWorkflowAgent(args: {
  gateway: GatewayManager; ctx: { runId: string; nodeId: string }; prompt: string;
  /** Explicit model selected by the shared workflow provider-catalog rule. */
  model: string;
  attempt?: number;
  agentSessionId: string;
  resumeSession?: boolean;
  noProgressMs?: number; deadlineMs?: number;
  onStreamEvent?: (event: AgentStreamEvent) => void | Promise<void>;
}): Promise<InvokeResult> {
  if (!args.gateway.isConnected()) return { status: 'failed', rawText: '', error: 'OpenClaw 网关未就绪' };
  const sessionKey = workflowGatewaySessionKey(args.agentSessionId);
  const activeKey = `${args.ctx.runId}:${args.ctx.nodeId}`;
  // A retry/continuation reconnects the durable node session instead of
  // creating a fresh transcript. Only the first attempt creates it.
  if (!args.resumeSession) {
    await args.gateway.rpc('sessions.create', {
      key: sessionKey,
      agentId: AGENT_ID,
      model: args.model,
    }, 120_000);
  }
  workflowExecLog('debug', 'agent-input', args.prompt, {
    runId: args.ctx.runId, nodeId: args.ctx.nodeId, execEngine: 'openclaw', sessionKey, model: args.model,
  });
  const timeoutMs = args.deadlineMs ?? WORKFLOW_AGENT_HARD_DEADLINE_MS;
  return new Promise<InvokeResult>((resolve) => {
    let rawText = ''; let settled = false; let lastProgress = Date.now(); let runId = '';
    let rateLimitRetryCount = 0;
    let rateLimitRetryScheduled = false;
    let lastRateLimitError = '';
    let rateLimitRetryTimer: ReturnType<typeof setTimeout> | undefined;
    const ignoredRunIds = new Set<string>();
    const finish = (result: InvokeResult) => {
      if (settled) return; settled = true; clearInterval(watchdog); clearTimeout(deadline); clearTimeout(rateLimitRetryTimer); activeSessions.delete(activeKey);
      args.gateway.off('chat:message', onMessage);
      workflowExecLog('debug', 'agent-final-output', result.rawText, {
        runId: args.ctx.runId, nodeId: args.ctx.nodeId, execEngine: 'openclaw', model: args.model,
        status: result.status, error: result.error,
      });
      // Keep the session until the retry coordinator reaches a node terminal
      // state. This lets retries and interrupted-run recovery continue the
      // exact same Gateway transcript.
      resolve(result);
    };
    // OpenClaw Gateway can emit the complete assistant packet without a
    // following `turn.completed` event. A complete workflow packet is the only
    // successful terminal value; plain final text must be retried, not treated
    // as a successful result with an absent output.
    const finishPacket = () => {
      const output = extractJsonFromText(rawText);
      if (!isWorkflowPacket(output)) return false;
      workflowExecLog('info', 'agent-terminal', 'OpenClaw smart node reached terminal state', {
        runId: args.ctx.runId,
        nodeId: args.ctx.nodeId,
        execEngine: 'openclaw',
        terminalSignal: 'workflow-packet',
      });
      finish({ status: 'succeeded', rawText, output });
      return true;
    };
    const finishMissingPacket = (terminalSignal: 'message.final' | 'turn.completed' | 'repeated-output') => {
      const error = terminalSignal === 'repeated-output'
        ? 'OpenClaw 检测到重复输出且未返回完整 WorkflowPacket JSON'
        : 'OpenClaw 节点已结束但未返回完整 WorkflowPacket JSON';
      workflowExecLog('warn', 'agent-terminal-invalid', error, {
        runId: args.ctx.runId,
        nodeId: args.ctx.nodeId,
        execEngine: 'openclaw',
        terminalSignal,
      });
      finish({ status: 'failed', rawText, error });
    };
    const sendChat = (retryNumber: number): void => {
      if (settled) return;
      rateLimitRetryScheduled = false;
      rawText = '';
      runId = '';
      lastProgress = Date.now();
      const idempotencyKey = `workflow-${args.ctx.runId}-${args.ctx.nodeId}-rate-${retryNumber}-${Date.now()}`;
      void args.gateway.rpc<{ runId?: string }>('chat.send', {
        sessionKey,
        message: retryNumber > 0
          ? openClawRateLimitRetryMessage(retryNumber)
          : args.prompt,
        deliver: false,
        idempotencyKey,
      }, 120_000)
        .then((result) => {
          runId = result?.runId ?? '';
          activeSessions.set(activeKey, { gateway: args.gateway, sessionKey, runId });
        })
        .catch((error) => finish({
          status: 'failed',
          rawText,
          error: error instanceof Error ? error.message : String(error),
        }));
    };
    const retryAfterRateLimit = (error: string, failedRunId?: string): void => {
      if (settled || rateLimitRetryScheduled) return;
      lastRateLimitError = error;
      if (rateLimitRetryCount >= OPENCLAW_RATE_LIMIT_MAX_RETRIES) {
        finish({
          status: 'failed',
          rawText,
          error: `模型服务请求过于频繁（HTTP 429），已按间隔重试 ${OPENCLAW_RATE_LIMIT_MAX_RETRIES} 次仍失败：${error}`,
        });
        return;
      }

      rateLimitRetryCount += 1;
      rateLimitRetryScheduled = true;
      const transportRunId = failedRunId || runId;
      if (transportRunId) ignoredRunIds.add(transportRunId);
      const retryNumber = rateLimitRetryCount;
      const delayMs = openClawRateLimitRetryDelayMs(retryNumber);
      lastProgress = Date.now();
      workflowExecLog('warn', 'agent-rate-limit-retry-scheduled', 'OpenClaw model rate limit retry scheduled', {
        runId: args.ctx.runId,
        nodeId: args.ctx.nodeId,
        execEngine: 'openclaw',
        sessionKey,
        retryNumber,
        maxRetries: OPENCLAW_RATE_LIMIT_MAX_RETRIES,
        delayMs,
      });
      void args.onStreamEvent?.({
        type: 'agent.progress',
        message: `模型服务请求受限，${Math.round(delayMs / 1_000)} 秒后进行第 ${retryNumber}/${OPENCLAW_RATE_LIMIT_MAX_RETRIES} 次重试`,
      });

      // End the failed transport run before recursively sending the next turn.
      // The durable workflow session remains unchanged, so transcript context
      // and completed side effects stay available to the retry.
      void args.gateway.rpc('chat.abort', { sessionKey, ...(transportRunId ? { runId: transportRunId } : {}) })
        .catch(() => undefined)
        .finally(() => {
          rateLimitRetryTimer = setTimeout(() => {
            if (settled) return;
            workflowExecLog('info', 'agent-rate-limit-retry-start', 'OpenClaw model rate limit retry started', {
              runId: args.ctx.runId,
              nodeId: args.ctx.nodeId,
              execEngine: 'openclaw',
              sessionKey,
              retryNumber,
              maxRetries: OPENCLAW_RATE_LIMIT_MAX_RETRIES,
            });
            sendChat(retryNumber);
          }, delayMs);
        });
    };
    const onMessage = (payload: unknown) => {
      const data = payload as { message?: Record<string, unknown>; engineEvent?: { sessionKey?: string; runId?: string; type?: string; errorMessage?: string } };
      const event = data?.engineEvent;
      if (!event || event.sessionKey !== sessionKey || (event.runId && ignoredRunIds.has(event.runId)) || (runId && event.runId && event.runId !== runId)) return;
      lastProgress = Date.now();
      const text = messageText(data.message);
      if (event.type === 'message.delta' && text) {
        rawText = mergeOpenClawStreamText(rawText, text);
        workflowExecLog('debug', 'agent-stream-event', text, { runId: args.ctx.runId, nodeId: args.ctx.nodeId, execEngine: 'openclaw' });
        void args.onStreamEvent?.({ type: 'agent.answer_delta', message: text, rawText });
        if (finishPacket()) return;
        if (findRepeatedOpenClawOutputPeriod(rawText)) {
          void args.gateway.rpc('chat.abort', { sessionKey, ...(runId ? { runId } : {}) }).catch(() => undefined);
          finishMissingPacket('repeated-output');
        }
      } else if (event.type === 'message.final') {
        if (text) rawText = text;
        if (!finishPacket()) {
          // A retry sent while OpenClaw is releasing the throttled run can
          // receive an empty final frame. Treat it as part of the same 429
          // retry chain instead of misreporting WorkflowPacket as missing.
          if (!text && lastRateLimitError) retryAfterRateLimit(lastRateLimitError, event.runId);
          else finishMissingPacket('message.final');
        }
      } else if (event.type === 'turn.failed') {
        const error = event.errorMessage ?? 'OpenClaw 执行失败';
        if (isOpenClawRateLimitError(error)) retryAfterRateLimit(error, event.runId);
        else finish({ status: 'failed', rawText, error });
      }
      else if (event.type === 'turn.aborted') {
        if (!rateLimitRetryScheduled) finish({ status: 'failed', rawText, error: '节点执行已取消' });
      }
      else if (event.type === 'turn.completed' && !finishPacket()) finishMissingPacket('turn.completed');
    };
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgress > (args.noProgressMs ?? WORKFLOW_AGENT_NO_PROGRESS_TIMEOUT_MS)) {
        void args.gateway.rpc('chat.abort', { sessionKey, ...(runId ? { runId } : {}) }).catch(() => undefined);
        finish({ status: 'failed', rawText, error: '节点执行超时(无进度看门狗)' });
      }
    }, 5_000);
    const deadline = setTimeout(() => {
      void args.gateway.rpc('chat.abort', { sessionKey, ...(runId ? { runId } : {}) }).catch(() => undefined);
      finish({ status: 'failed', rawText, error: '节点执行超时(硬截止)' });
    }, timeoutMs);
    args.gateway.on('chat:message', onMessage);
    activeSessions.set(activeKey, { gateway: args.gateway, sessionKey });
    sendChat(0);
  });
}

export async function releaseOpenClawWorkflowAgentSession(nodeSessionId: string): Promise<void> {
  const sessionKey = workflowGatewaySessionKey(nodeSessionId);
  const cleanup = await cleanupWorkflowOpenClawSession(sessionKey);
  workflowExecLog('info', 'openclaw-session-cleanup', 'workflow Gateway session removed', {
    execEngine: 'openclaw', sessionKey, removed: cleanup.removed, transcriptCount: cleanup.transcriptCount,
  });
}

export function cancelOpenClawWorkflowAgent(runId: string, nodeId?: string): void {
  for (const [key, active] of activeSessions) {
    if (key !== `${runId}:${nodeId ?? ''}` && !(nodeId === '' && key.startsWith(`${runId}:`))) continue;
    void active.gateway.rpc('chat.abort', { sessionKey: active.sessionKey, ...(active.runId ? { runId: active.runId } : {}) }).catch(() => undefined);
  }
}
