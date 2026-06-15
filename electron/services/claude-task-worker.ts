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

export interface ClaudeTaskExecutionResult {
  completedAt?: string;
  error?: string;
  runtimeResult?: ClaudeScheduledTaskRunRecord['runtimeResult'];
  status: ClaudeScheduledTaskRunRecord['status'];
  summary?: string;
}

export type ClaudeTaskExecutor = (params: {
  definition: ClaudeScheduledTaskDefinition;
  run: ClaudeScheduledTaskRunRecord;
}) => Promise<ClaudeTaskExecutionResult>;

function nowIso(): string {
  return new Date().toISOString();
}

async function executeClaudeTask(params: {
  definition: ClaudeScheduledTaskDefinition;
  run: ClaudeScheduledTaskRunRecord;
}): Promise<ClaudeTaskExecutionResult> {
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
  const timeoutMs = Math.max(1, params.definition.timeoutSec) * 1000;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    query.close();
  }, timeoutMs);

  try {
    for await (const message of query as AsyncIterable<Record<string, unknown>>) {
      if (typeof message.session_id === 'string' && message.session_id.trim()) {
        actualSessionId = message.session_id.trim();
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
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (actualSessionId !== runtime.sessionId) {
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
  }

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
  constructor(private readonly executor: ClaudeTaskExecutor = executeClaudeTask) {}

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
      const execution = await this.executor({ definition, run: runningRecord });
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
