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

const AGENT_ID = 'workflow-runtime';
const activeSessions = new Map<string, { gateway: GatewayManager; sessionKey: string; runId?: string }>();
const configuredGateways = new WeakSet<GatewayManager>();

/** Ensure this agent uses only the versioned workflow-owned bootstrap files. */
export async function ensureWorkflowOpenClawAgent(): Promise<void> {
  const workspace = workflowRuntimeWorkspacePath();
  const prepared = await ensureWorkflowRuntimeTemplates(workspace);
  workflowExecLog('info', 'openclaw-workspace-template', 'workflow runtime templates prepared', {
    templateVersion: prepared.templateVersion,
    createdFiles: prepared.createdFiles,
    updatedFiles: prepared.updatedFiles,
    removedFiles: prepared.removedFiles,
  });
  // skipBootstrap prevents Gateway from creating its default definitions.
  await createAgentWithId(AGENT_ID, 'Workflow Runtime', { workspace, skipBootstrap: true });
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
  await ensureWorkflowOpenClawAgent();
  if (!configuredGateways.has(args.gateway)) {
    await args.gateway.reload();
    configuredGateways.add(args.gateway);
    if (!args.gateway.isConnected()) return { status: 'failed', rawText: '', error: 'OpenClaw 网关重载后未就绪' };
    // Validate again after Gateway startup so its defaults cannot replace the
    // workflow-owned definitions before the first node prompt is sent.
    await ensureWorkflowOpenClawAgent();
  }
  const sessionKey = workflowGatewaySessionKey(args.agentSessionId);
  const activeKey = `${args.ctx.runId}:${args.ctx.nodeId}`;
  const idempotencyKey = `workflow-${args.ctx.runId}-${args.ctx.nodeId}-${Date.now()}`;
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
  const timeoutMs = args.deadlineMs ?? 960_000;
  return new Promise<InvokeResult>((resolve) => {
    let rawText = ''; let settled = false; let lastProgress = Date.now(); let runId = '';
    const finish = (result: InvokeResult) => {
      if (settled) return; settled = true; clearInterval(watchdog); clearTimeout(deadline); activeSessions.delete(activeKey);
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
    // following `turn.completed` event. This is intentionally distinct from
    // the Claude SDK path, whose async iterator has a reliable completion
    // signal. A complete workflow packet is itself a terminal protocol value;
    // settle immediately instead of waiting for the no-progress watchdog.
    const finishSucceeded = (terminalSignal: 'workflow-packet' | 'message.final' | 'turn.completed') => {
      const output = extractJsonFromText(rawText);
      workflowExecLog('info', 'agent-terminal', 'OpenClaw smart node reached terminal state', {
        runId: args.ctx.runId,
        nodeId: args.ctx.nodeId,
        execEngine: 'openclaw',
        terminalSignal,
      });
      finish({ status: 'succeeded', rawText, output });
    };
    const onMessage = (payload: unknown) => {
      const data = payload as { message?: Record<string, unknown>; engineEvent?: { sessionKey?: string; runId?: string; type?: string; errorMessage?: string } };
      const event = data?.engineEvent;
      if (!event || event.sessionKey !== sessionKey || (runId && event.runId && event.runId !== runId)) return;
      lastProgress = Date.now();
      const text = messageText(data.message);
      if (event.type === 'message.delta' && text) {
        rawText = mergeOpenClawStreamText(rawText, text);
        workflowExecLog('debug', 'agent-stream-event', text, { runId: args.ctx.runId, nodeId: args.ctx.nodeId, execEngine: 'openclaw' });
        void args.onStreamEvent?.({ type: 'agent.answer_delta', message: text, rawText });
        if (isWorkflowPacket(extractJsonFromText(rawText))) finishSucceeded('workflow-packet');
      } else if (event.type === 'message.final') {
        if (text) rawText = text;
        finishSucceeded('message.final');
      } else if (event.type === 'turn.failed') finish({ status: 'failed', rawText, error: event.errorMessage ?? 'OpenClaw 执行失败' });
      else if (event.type === 'turn.aborted') finish({ status: 'failed', rawText, error: '节点执行已取消' });
      else if (event.type === 'turn.completed') finishSucceeded('turn.completed');
    };
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgress > (args.noProgressMs ?? 300_000)) {
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
    void args.gateway.rpc<{ runId?: string }>('chat.send', { sessionKey, message: args.prompt, deliver: false, idempotencyKey }, 120_000)
      .then((result) => {
        runId = result?.runId ?? '';
        activeSessions.set(activeKey, { gateway: args.gateway, sessionKey, runId });
      })
      .catch((error) => finish({ status: 'failed', rawText, error: error instanceof Error ? error.message : String(error) }));
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
