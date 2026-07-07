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
import { normalizeToolName } from '../../shared/scheduled-task-instruction';
import { sendWorkflowResultFallback } from './claude-task-workflow-watchdog';

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

/** 解析一段文本里可能内嵌的 JSON 片段（工具文本输出常带 markdown 代码栅栏或说明文字）。 */
function tryParseJson(text: string): { domain?: string; type?: string; data?: { runId?: string } } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // 尝试取首个 `{ ... }` 子串再解析。
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
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

  // 工作流超时兜底所需的状态：从 SDK 消息流实时捕获。
  // - workflowRunIds：从 `get_workflow_status` 的 tool_use.input.runId 与
  //   `execute_workflow` 响应信封 data.runId 两路收集，用于超时后直连工作流 API 轮询。
  // - pendingDwsSendToolUseIds：agent 发起的 `dws chat message send` Bash 调用的
  //   tool_use_id；其 tool_result 非 error 即说明钉钉已发成功，避免兜底重发。
  const workflowRunIds = new Set<string>();
  const pendingDwsSendToolUseIds = new Set<string>();
  let dingtalkAlreadySent = false;

  // —— 诊断日志：任务启动画像，便于排查"工作流跑完却没发钉钉"——
  // 5 分钟级工作流不会被超时掐断（默认 1800s），此类问题多源于 agent 自身未发 /
  // 发送失败 / 工作流未真完成，故在此打印关键启动信号。
  {
    const tpl = params.definition.promptTemplate ?? '';
    const hasRecipient = /STOCLAW:DINGTALK_RECIPIENTS/i.test(tpl);
    const hasWorkflow = /execute_workflow|get_workflow_status|workflowId/i.test(tpl);
    logger.info(
      `[ClaudeTaskWorker] task start name=${params.definition.name} timeoutSec=${params.definition.timeoutSec} hasRecipientMarker=${hasRecipient} hasWorkflowMarker=${hasWorkflow}`,
    );
  }

  function readBlockText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  // Extract run-record fields from the SDK message stream. consumeClaudeQuery
  // owns event emission + liveClaudeMessages population; this callback only
  // captures what the run record needs (summary text, runtime result, actual
  // session id) plus the workflow watchdog signals. It is invoked for
  // user/assistant/result messages (not stream_event, which consumeClaudeQuery
  // continues past) — including the synthetic `user` messages that carry
  // tool_result blocks (claude-adapter.ts consumeClaudeQuery awaits
  // onMessage for every non-stream message).
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

        // 工作流 runId / dws 发送意图从 assistant 的 tool_use 块捕获。
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          const record = block as Record<string, unknown>;
          if (record.type !== 'tool_use' || typeof record.id !== 'string') continue;
          const toolName = normalizeToolName(String(record.name ?? ''));
          const input = record.input;
          const inputRecord = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

          if (toolName === 'get_workflow_status' && typeof inputRecord.runId === 'string' && inputRecord.runId.trim()) {
            workflowRunIds.add(inputRecord.runId.trim());
          }
          if (toolName === 'Bash' && typeof inputRecord.command === 'string') {
            const cmd = inputRecord.command;
            if (/dws\b/.test(cmd) && /chat\s+message\s+send\b/.test(cmd)) {
              pendingDwsSendToolUseIds.add(record.id);
            }
          }
        }
      }
    }
    if (message.type === 'user' && 'message' in message) {
      // synthetic user message 携带 tool_result 块：据此判定 dws 是否已发成功、
      // 并从 execute_workflow 响应信封补捕 runId。
      const payload = (message as { message?: { content?: unknown } }).message;
      const content = payload?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          const record = block as Record<string, unknown>;
          if (record.type !== 'tool_result' || typeof record.tool_use_id !== 'string') continue;

          if (pendingDwsSendToolUseIds.has(record.tool_use_id)) {
            const preview = readBlockText(record.content).replace(/\s+/g, ' ').slice(0, 160);
            if (record.is_error === true) {
              logger.warn(
                `[ClaudeTaskWorker] dws send FAILED (is_error) toolUseId=${record.tool_use_id} content=${preview}`,
              );
            } else {
              dingtalkAlreadySent = true;
            }
          }

          const text = readBlockText(record.content);
          if (!text) continue;
          // execute_workflow 响应信封形如：
          // { type:'workflow_execution_started', domain:'workflow', success:true, data:{ runId, ... } }
          // tryParseJson 会自行剥离 markdown 代码栅栏与说明文字。
          const obj = tryParseJson(text);
          if (obj?.domain === 'workflow'
            && obj.type === 'workflow_execution_started'
            && typeof obj.data?.runId === 'string'
            && obj.data.runId.trim()) {
            workflowRunIds.add(obj.data.runId.trim());
          }
        }
      }
    }
    if (message.type === 'result') {
      const stopReason = message.stop_reason ?? message.stopReason;
      const subtypeStr = typeof message.subtype === 'string' ? message.subtype : '';
      const stopReasonStr = typeof stopReason === 'string' ? stopReason : '';
      const isErrorFlag = subtypeStr.startsWith('error_');
      const durationMsVal = typeof message.duration_ms === 'number'
        ? message.duration_ms
        : typeof message.durationMs === 'number'
          ? message.durationMs
          : undefined;
      runtimeResult = {
        type: typeof message.type === 'string' ? message.type : undefined,
        subtype: subtypeStr || undefined,
        stopReason: stopReasonStr || null,
        isError: isErrorFlag,
        durationMs: durationMsVal,
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
    // 工作流超时钉钉兜底：仅当 agent 卡在工作流轮询、且从未成功发出钉钉时，
    // 异步接管轮询服务端工作流运行态并把结果发给已配置的收件人。
    // fire-and-forget——绝不让本兜底把 worker 主流程拖死或抛错。
    logger.warn(
      `[ClaudeTaskWorker] task TIMED OUT workflowRunIds=${workflowRunIds.size} dingtalkAlreadySent=${dingtalkAlreadySent}`,
    );
    if (workflowRunIds.size > 0 && !dingtalkAlreadySent) {
      logger.info(`[ClaudeTaskWorker] firing workflow fallback (timeout) runs=${workflowRunIds.size}`);
      void sendWorkflowResultFallback({
        taskName: params.definition.name,
        promptTemplate: params.definition.promptTemplate,
        workflowRunIds: [...workflowRunIds],
        dingtalkAlreadySent,
      }).catch((err) => {
        logger.warn(
          `[ClaudeTaskWorker] workflow fallback threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    } else {
      logger.info('[ClaudeTaskWorker] no fallback on timeout (no runId or already sent)');
    }
    return {
      completedAt: nowIso(),
      error: `Claude task timed out after ${params.definition.timeoutSec}s`,
      runtimeResult,
      status: 'timed_out',
      summary: lastAssistantText || undefined,
    };
  }

  // —— 关键诊断：非超时结束时的钉钉发送画像 ——
  // 5 分钟级工作流会走到这里。若 status=succeeded 且 dingtalkAlreadySent=false，
  // 即说明 agent 跑完但没成功发钉钉（最常见根因：agent 压根没调 dws，或调了但 is_error，
  // 或 prompt 仅要求"执行工作流"而未要求"把结果发钉钉"）。
  const finalStatus = runtimeResult?.isError ? 'failed' : 'succeeded';
  logger.info(
    `[ClaudeTaskWorker] task end status=${finalStatus} workflowRunIds=${workflowRunIds.size} dingtalkAlreadySent=${dingtalkAlreadySent} dwsSendAttempts=${pendingDwsSendToolUseIds.size} stopReason=${runtimeResult?.stopReason ?? '(none)'}`,
  );

  // —— 非超时兜底：agent 正常结束但有工作流 runId 且未发钉钉 ——
  // 场景：prompt 仅要求"执行工作流"，agent 执行后 end_turn，没有主动发钉钉。
  // 本兜底异步轮询 runId 到终态并把结果补发给已配置收件人。
  if (workflowRunIds.size > 0 && !dingtalkAlreadySent) {
    logger.info(`[ClaudeTaskWorker] firing workflow fallback (normal-completion) runs=${workflowRunIds.size}`);
    void sendWorkflowResultFallback({
      taskName: params.definition.name,
      promptTemplate: params.definition.promptTemplate,
      workflowRunIds: [...workflowRunIds],
      dingtalkAlreadySent,
    }).catch((err) => {
      logger.warn(
        `[ClaudeTaskWorker] workflow fallback threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  return {
    completedAt: nowIso(),
    runtimeResult,
    status: finalStatus,
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
