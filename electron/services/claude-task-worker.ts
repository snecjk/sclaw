import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';
import {
  appendClaudeScheduledTaskRunRecord,
  deleteClaudeScheduledTaskLease,
  getClaudeScheduledTaskDefinition,
  getClaudeScheduledTaskLease,
  type ClaudeScheduledTaskDefinition,
  type ClaudeScheduledTaskRunRecord,
  upsertClaudeScheduledTaskLease,
} from './claude-scheduled-task-store';
import {
  appendClaudeScheduledTaskSummaryRun,
  buildClaudeTaskRunSessionKey,
} from './claude-scheduled-task-session-store';
import { buildClaudeTaskRuntimeContext } from './claude-task-runtime-builder';
import { upsertEngineSessionRegistryEntry } from '../engines/session-registry';
import { consumeClaudeQuery } from '../engines/claude-adapter';

export interface ClaudeTaskExecutionResult {
  completedAt?: string;
  error?: string;
  runtimeResult?: ClaudeScheduledTaskRunRecord['runtimeResult'];
  status: ClaudeScheduledTaskRunRecord['status'];
  summary?: string;
}

/**
 * Minimal event sink used to forward Claude SDK streaming events to the
 * renderer. Backed at runtime by the GatewayManager EventEmitter, which
 * bridges `chat:message` / `notification` events to the same IPC broadcast
 * the OpenClaw Gateway uses — so the renderer's existing state machine handles
 * them without any renderer-side changes. Mirrors ClaudeEventSink in
 * electron/engines/claude-adapter.ts; kept local so scheduled-task execution
 * stays decoupled from the interactive adapter.
 */
export type ClaudeTaskEventSink = {
  emit(event: string, payload: unknown): boolean;
};

export type ClaudeTaskExecutor = (params: {
  definition: ClaudeScheduledTaskDefinition;
  run: ClaudeScheduledTaskRunRecord;
  eventSink: ClaudeTaskEventSink | null;
}) => Promise<ClaudeTaskExecutionResult>;

function nowIso(): string {
  return new Date().toISOString();
}

async function executeClaudeTask(params: {
  definition: ClaudeScheduledTaskDefinition;
  run: ClaudeScheduledTaskRunRecord;
  eventSink: ClaudeTaskEventSink | null;
}): Promise<ClaudeTaskExecutionResult> {
  const { runId, sessionKey } = params.run;
  const eventSink = params.eventSink;
  const runtime = await buildClaudeTaskRuntimeContext(params.definition, {
    runId: params.run.runId,
    sessionId: params.run.runId,
    sessionKey: params.run.sessionKey,
  });
  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  await upsertEngineSessionRegistryEntry({
    sessionKey: params.run.sessionKey,
    sessionId: runtime.sessionId,
    cwd: runtime.cwd,
    agentId: params.definition.agentId,
    engineType: 'claude',
    updatedAt: Date.now(),
    title: params.definition.name,
    model: runtime.model,
    accountId: runtime.accountId,
  });

  const query = sdk.query({
    prompt: params.definition.promptTemplate,
    options: {
      cwd: runtime.cwd,
      additionalDirectories: runtime.additionalDirectories,
      env: runtime.env,
      sessionId: runtime.sessionId,
      settings: runtime.model ? { model: runtime.model } : undefined,
      settingSources: ['user' as const],
      skills: 'all' as const,
      pathToClaudeCodeExecutable: runtime.pathToClaudeCodeExecutable,
      hooks: runtime.runtimeOptions.hooks,
      mcpServers: runtime.runtimeOptions.mcpServers,
      plugins: runtime.plugins,
      allowDangerouslySkipPermissions: runtime.permissionMode === 'bypassPermissions',
      permissionMode: runtime.permissionMode,
      // Enable token-level streaming events (SDKPartialAssistantMessage) so the
      // consumer loop can forward text deltas to the renderer in real time.
      includePartialMessages: true,
      systemPrompt: runtime.runtimeOptions.systemPromptAppend
        ? {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: runtime.runtimeOptions.systemPromptAppend,
        }
        : undefined,
    },
  });

  let timedOut = false;
  let lastAssistantText = '';
  let runtimeResult: ClaudeScheduledTaskRunRecord['runtimeResult'];
  let actualSessionId = runtime.sessionId;

  // Extract run-record fields from the SDK message stream. consumeClaudeQuery
  // owns event emission + liveClaudeMessages population; this callback only
  // captures what the run record needs (summary text, runtime result, actual
  // session id). It is invoked for user/assistant/result messages (not
  // stream_event, which consumeClaudeQuery continues past).
  const onMessage = (message: Record<string, unknown>) => {
    if (typeof message.session_id === 'string' && message.session_id.trim()) {
      actualSessionId = message.session_id.trim();
    }
    if (message.type === 'assistant' && 'message' in message) {
      const payload = (message as { message?: { content?: unknown } }).message;
      const content = payload?.content;
      if (typeof content === 'string') {
        lastAssistantText = content;
      } else if (Array.isArray(content)) {
        lastAssistantText = content
          .map((block) => {
            if (!block || typeof block !== 'object') return '';
            const record = block as Record<string, unknown>;
            return typeof record.text === 'string' ? record.text : '';
          })
          .filter(Boolean)
          .join('\n');
      }
    }
    if (message.type === 'result') {
      const stopReason = message.stop_reason ?? message.stopReason;
      runtimeResult = {
        type: typeof message.type === 'string' ? message.type : undefined,
        subtype: typeof message.subtype === 'string' ? message.subtype : undefined,
        stopReason: typeof stopReason === 'string' ? stopReason : null,
        isError: typeof message.subtype === 'string' ? message.subtype.startsWith('error_') : false,
        durationMs: typeof message.duration_ms === 'number'
          ? message.duration_ms
          : typeof message.durationMs === 'number'
            ? message.durationMs
            : undefined,
      };
    }
  };

  const timeoutMs = Math.max(1, params.definition.timeoutSec) * 1000;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    query.close();
  }, timeoutMs);

  try {
    // Delegate streaming event emission and liveClaudeMessages population to
    // the same path the interactive claudeAdapter uses (consumeClaudeQuery).
    // liveClaudeMessages is essential: the renderer's completion-triggered
    // history reload can race ahead of the SDK flushing the transcript to disk,
    // and without the in-memory cache buildHistory returns empty and wipes the
    // just-streamed messages.
    await consumeClaudeQuery(
      sessionKey,
      runtime.sessionId,
      runtime.cwd,
      query as AsyncIterable<Record<string, unknown>> & { close(): void },
      eventSink,
      runId,
      onMessage,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Restore registry metadata that consumeClaudeQuery overwrites with
  // key-derived defaults (agentId='main' for the claude-task-run key, title
  // derived from the prompt) so the session stays attributed to the task's
  // agent and named after the task.
  await upsertEngineSessionRegistryEntry({
    sessionKey: params.run.sessionKey,
    sessionId: actualSessionId,
    cwd: runtime.cwd,
    agentId: params.definition.agentId,
    engineType: 'claude',
    updatedAt: Date.now(),
    title: params.definition.name,
    model: runtime.model,
    accountId: runtime.accountId,
  });

  if (timedOut) {
    return {
      completedAt: nowIso(),
      error: `Claude task timed out after ${params.definition.timeoutSec}s`,
      runtimeResult,
      status: 'timed_out',
      summary: lastAssistantText || undefined,
    };
  }

  return {
    completedAt: nowIso(),
    runtimeResult,
    status: runtimeResult?.isError ? 'failed' : 'succeeded',
    summary: lastAssistantText || undefined,
  };
}

export class ClaudeTaskWorker {
  private eventSink: ClaudeTaskEventSink | null = null;

  constructor(private readonly executor: ClaudeTaskExecutor = executeClaudeTask) {}

  /** Inject the gateway event sink so worker runs can stream to the renderer. */
  setEventSink(sink: ClaudeTaskEventSink | null): void {
    this.eventSink = sink;
  }

  private async prepareRun(params: {
    attempt?: number;
    scheduledFor?: string;
    taskId: string;
    triggerSource: ClaudeScheduledTaskRunRecord['triggerSource'];
  }): Promise<{
    definition: ClaudeScheduledTaskDefinition;
    runningRecord: ClaudeScheduledTaskRunRecord;
  }> {
    const definition = await getClaudeScheduledTaskDefinition(params.taskId);
    if (!definition) {
      throw new Error(`Claude scheduled task "${params.taskId}" not found`);
    }

    const existingLease = await getClaudeScheduledTaskLease(definition.id);
    if (existingLease && new Date(existingLease.leaseUntil).getTime() > Date.now()) {
      throw new Error(`Claude scheduled task "${definition.id}" is already running`);
    }

    const scheduledFor = params.scheduledFor ?? nowIso();
    const attempt = params.attempt ?? 1;
    const runId = randomUUID();
    const sessionKey = buildClaudeTaskRunSessionKey(definition.id, runId);
    const startedAt = nowIso();
    const runningRecord: ClaudeScheduledTaskRunRecord = {
      runId,
      taskId: definition.id,
      status: 'running',
      triggerSource: params.triggerSource,
      scheduledFor,
      startedAt,
      attempt,
      idempotencyKey: `${definition.id}:${scheduledFor}:${attempt}`,
      sessionKey,
      runtimeSnapshot: {
        workspacePath: definition.workspacePath,
        providerAccountId: definition.providerAccountId,
        model: definition.model,
        permissionProfile: definition.permissionProfile,
        pluginPaths: [],
      },
    };

    await upsertClaudeScheduledTaskLease({
      taskId: definition.id,
      runId,
      leaseUntil: new Date(Date.now() + Math.max(1, definition.timeoutSec) * 1000).toISOString(),
    });
    await appendClaudeScheduledTaskRunRecord(runningRecord);

    return { definition, runningRecord };
  }

  private async executePreparedRun(
    definition: ClaudeScheduledTaskDefinition,
    runningRecord: ClaudeScheduledTaskRunRecord,
  ): Promise<ClaudeScheduledTaskRunRecord> {
    try {
      const execution = await this.executor({ definition, run: runningRecord, eventSink: this.eventSink });
      const finalRecord: ClaudeScheduledTaskRunRecord = {
        ...runningRecord,
        completedAt: execution.completedAt ?? nowIso(),
        error: execution.error,
        runtimeResult: execution.runtimeResult,
        status: execution.status,
        summary: execution.summary,
      };
      await appendClaudeScheduledTaskRunRecord(finalRecord);
      await appendClaudeScheduledTaskSummaryRun(definition, finalRecord);
      return finalRecord;
    } catch (error) {
      const finalRecord: ClaudeScheduledTaskRunRecord = {
        ...runningRecord,
        completedAt: nowIso(),
        error: error instanceof Error ? error.message : String(error),
        status: 'failed',
      };
      await appendClaudeScheduledTaskRunRecord(finalRecord);
      await appendClaudeScheduledTaskSummaryRun(definition, finalRecord);
      logger.warn('[claude-task] worker run failed', { taskId: definition.id, runId: runningRecord.runId, error: finalRecord.error });
      return finalRecord;
    } finally {
      await deleteClaudeScheduledTaskLease(definition.id);
    }
  }

  async runTask(params: {
    attempt?: number;
    scheduledFor?: string;
    taskId: string;
    triggerSource: ClaudeScheduledTaskRunRecord['triggerSource'];
  }): Promise<ClaudeScheduledTaskRunRecord> {
    const { definition, runningRecord } = await this.prepareRun(params);
    return this.executePreparedRun(definition, runningRecord);
  }

  async startTask(params: {
    attempt?: number;
    scheduledFor?: string;
    taskId: string;
    triggerSource: ClaudeScheduledTaskRunRecord['triggerSource'];
  }): Promise<ClaudeScheduledTaskRunRecord> {
    const { definition, runningRecord } = await this.prepareRun(params);

    void this.executePreparedRun(definition, runningRecord).catch((error) => {
      logger.warn('[claude-task] detached worker run failed unexpectedly', {
        taskId: definition.id,
        runId: runningRecord.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return runningRecord;
  }
}
