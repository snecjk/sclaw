import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { buildPiSessionConfig, deletePiSession } from '../../engines/pi-adapter';
import { resolveAgentIdForSessionKey } from '../../engines/session-engine';
import {
  getEngineSessionRegistryEntry,
  upsertEngineSessionRegistryEntry,
} from '../../engines/session-registry';
import type { NormalizedEngineEvent } from '../../gateway/normalized-engine-event';
import { getPiRuntimeService } from '../pi-runtime-service';
import type { PiPromptResult } from '../../../shared/pi-runtime-protocol';
import { extractJsonFromText } from './agent-output';
import type { AgentStreamEvent, InvokeResult } from './agent-runner-claude';
import { workflowExecLog } from './logging';
import { prepareWorkflowSkills } from './skill-loader';
import {
  WORKFLOW_AGENT_HARD_DEADLINE_MS,
  WORKFLOW_AGENT_NO_PROGRESS_TIMEOUT_MS,
} from '../../../shared/workflow-agent-timeouts';
import { workflowPiSessionKey } from '../../../shared/workflow-pi-session';

type ActiveRun = {
  sessionKey: string;
  finish: (result: InvokeResult) => void;
};

const activeRuns = new Map<string, ActiveRun>();

function textFromMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromMessage).join('');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if ('content' in record) return textFromMessage(record.content);
  if ('message' in record) return textFromMessage(record.message);
  return '';
}

export function cancelPiWorkflowAgent(runId: string, nodeId?: string): void {
  const matches = nodeId
    ? [[`${runId}:${nodeId}`, activeRuns.get(`${runId}:${nodeId}`)] as const]
    : [...activeRuns.entries()].filter(([key]) => key.startsWith(`${runId}:`));
  for (const [, active] of matches) {
    if (!active) continue;
    void getPiRuntimeService().request('session.abort', { sessionKey: active.sessionKey }).catch(() => undefined);
    active.finish({ status: 'failed', rawText: '', error: '节点执行已取消' });
  }
}

export async function releasePiWorkflowAgentSession(agentSessionId: string): Promise<void> {
  await deletePiSession(workflowPiSessionKey(agentSessionId));
}

/** Run one workflow smart node in an isolated, resumable PI Worker session. */
export async function invokePiWorkflowAgent(args: {
  ctx: { runId: string; nodeId: string };
  prompt: string;
  model: string;
  agentSessionId: string;
  originSessionKey: string;
  cwd: string;
  noProgressMs?: number;
  deadlineMs?: number;
  onStreamEvent?: (event: AgentStreamEvent) => void | Promise<void>;
}): Promise<InvokeResult> {
  const sessionKey = workflowPiSessionKey(args.agentSessionId);
  const originSession = await getEngineSessionRegistryEntry(args.originSessionKey);
  const agentId = originSession?.agentId || await resolveAgentIdForSessionKey(args.originSessionKey);
  await mkdir(args.cwd, { recursive: true });
  await prepareWorkflowSkills(['pi']);
  await upsertEngineSessionRegistryEntry({
    sessionKey,
    engineType: 'pi',
    agentId,
    cwd: args.cwd,
    model: args.model,
    provider: originSession?.engineType === 'pi' ? originSession.provider : undefined,
    accountId: originSession?.engineType === 'pi' ? originSession.accountId : undefined,
    updatedAt: Date.now(),
  });
  const runId = randomUUID();
  const { config, entry } = await buildPiSessionConfig(sessionKey, runId, {
    sessionKey,
    message: args.prompt,
    idempotencyKey: runId,
    media: [],
  });
  config.model = { ...config.model, model: args.model };
  config.agentId = agentId;
  config.disableAgentExtensions = true;
  config.systemPrompt = [
    config.systemPrompt,
    'You are executing one isolated SClaw workflow node.',
    'Return only one complete WorkflowPacket JSON object as the final answer. Do not use Markdown fences or prose.',
  ].filter(Boolean).join('\n\n');

  const runtime = getPiRuntimeService();
  const key = `${args.ctx.runId}:${args.ctx.nodeId}`;
  const deadlineMs = Math.max(args.deadlineMs ?? WORKFLOW_AGENT_HARD_DEADLINE_MS, 1_000);
  const noProgressMs = Math.max(args.noProgressMs ?? WORKFLOW_AGENT_NO_PROGRESS_TIMEOUT_MS, 1_000);
  let rawText = '';
  let settled = false;
  let lastProgressAt = Date.now();

  return new Promise<InvokeResult>((resolve) => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    const finish = (result: InvokeResult) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      if (watchdog) clearInterval(watchdog);
      runtime.off('event', onEvent);
      activeRuns.delete(key);
      resolve(result);
    };
    const abortWith = (error: string) => {
      void runtime.request('session.abort', { sessionKey }).catch(() => undefined);
      finish({ status: 'failed', rawText, error });
    };
    const onEvent = (event: NormalizedEngineEvent) => {
      if (event.sessionKey !== sessionKey) return;
      if (event.runId && event.runId !== runId) return;
      lastProgressAt = Date.now();
      if (event.type === 'message.delta') {
        const next = textFromMessage(event.message);
        rawText = rawText && next.startsWith(rawText) ? next : `${rawText}${next}`;
        void args.onStreamEvent?.({ type: 'agent.answer_delta', message: next, rawText });
        return;
      }
      if (event.type === 'message.final') {
        const next = textFromMessage(event.message);
        if (next) rawText = next;
        return;
      }
      if (event.type === 'tool.result') {
        const message = event.message as Record<string, unknown> | undefined;
        void args.onStreamEvent?.({
          type: 'agent.tool_end',
          message: textFromMessage(message),
          toolName: typeof message?.toolName === 'string' ? message.toolName : undefined,
          callId: typeof message?.toolCallId === 'string' ? message.toolCallId : undefined,
          isError: Boolean(message?.isError),
        });
        return;
      }
      if (event.type === 'turn.completed') {
        const output = extractJsonFromText(rawText);
        finish(output
          ? { status: 'succeeded', rawText, output }
          : { status: 'failed', rawText, error: 'SAgent 节点未返回完整 WorkflowPacket JSON' });
        return;
      }
      if (event.type === 'turn.failed' || event.type === 'turn.interrupted') {
        finish({ status: 'failed', rawText, error: event.errorMessage ?? 'SAgent 工作流节点执行失败' });
        return;
      }
      if (event.type === 'turn.aborted') finish({ status: 'failed', rawText, error: '节点执行已取消' });
    };

    runtime.on('event', onEvent);
    activeRuns.set(key, { sessionKey, finish });
    watchdog = setInterval(() => {
      if (Date.now() - lastProgressAt > noProgressMs) abortWith('SAgent 节点执行超时（无进度）');
    }, Math.min(5_000, noProgressMs));
    deadline = setTimeout(() => abortWith('SAgent 节点执行超时（硬截止）'), deadlineMs);

    void runtime.request<PiPromptResult>('session.prompt', {
      sessionKey,
      payload: { config, message: args.prompt, runId, media: [] },
    }).then(async (result) => {
      await upsertEngineSessionRegistryEntry({
        ...entry,
        sessionKey,
        engineType: 'pi',
        agentId,
        cwd: args.cwd,
        model: args.model,
        sessionId: result.sessionId,
        piSessionFile: result.sessionFile,
        updatedAt: Date.now(),
      });
      workflowExecLog('info', 'pi-agent-started', 'SAgent workflow node accepted', {
        runId: args.ctx.runId,
        nodeId: args.ctx.nodeId,
        sessionKey,
        model: args.model,
      });
    }).catch((error) => finish({
      status: 'failed',
      rawText,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}
