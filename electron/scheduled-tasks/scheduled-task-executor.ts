import type { GatewayManager } from '../gateway/manager';
import type { ScheduledTaskDispatcher } from './scheduled-task-scheduler';
import type { ScheduleTaskRunRepository } from '../db/repositories/schedule-task-run-repository';
import type { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';
import type {
  ScheduleTask,
  ScheduleTaskRuntimeResult,
  ScheduleTaskRun,
} from '../db/models/domain/schedule-task';
import type { EngineAdapterContext } from '../engines/types';
import { getAdapter } from '../engines/manager';
import { runMainChatSend, type MainChatSendInput } from '../services/chat-send-service';
import { logger } from '../utils/logger';
import { attachRunWatcher, type RunWatcherTerminalSignal } from './scheduled-task-run-watcher';
import { resolveScheduledTaskDingTalkRecipients } from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';
import { prependSystemPromptAppend } from '../../shared/system-prompt-append';
import { collectArtifactsFromAssistantMessages } from '../services/data-center-artifact-sync/artifact-collector';
import {
  resolveDataCenterTargetsFromUris,
  syncArtifactsToDataCenter,
} from '../services/data-center-artifact-sync';

/**
 * 引擎无关的执行期 dispatcher。把 `ScheduledTaskScheduler` 交出的 `{ task, run }`
 * 落到真实引擎执行——走与交互式 chat 同构的 `runMainChatSend`（内存注入 + 幂等 +
 * 适配器 `sendMessage`）。
 *
 * 职责：当日占位会话 → run 置 running → send；成功发 succeeded 事件；失败按
 * `retryPolicy` 重试（`createRun(triggerSource='recovery')` + backoff 后自调度
 * dispatch），重试耗尽按 `failurePolicy.pauseAfterConsecutiveFailures` 置 task
 * disabled 并发 paused 事件。终态由 gateway 事件经 run watcher 闭环（sendMessage
 * resolve 只代表 run 启动）。
 *
 * 依赖全部由 `ScheduledTaskService.setGatewayManager` 以闭包注入——执行器本身不 import
 * service，避免 service ↔ executor 循环；sessionKey 构造与 dingtalk 烘焙仍是 service
 * 的单一职责（executor 只消费其产物）。
 */

/**
 * run 生命周期 / task pause 的事件频道。service 注入的 gateway sink 把事件 emit 到
 * `GatewayManager`（经现有 IPC 桥透给 renderer）。未注入时用 `loggingEventSink`
 * 仅落日志，执行链路不受影响。
 */
export type ScheduledTaskEvent =
  | 'scheduled-task:run:succeeded'
  | 'scheduled-task:run:failed'
  | 'scheduled-task:run:retrying'
  | 'scheduled-task:task:paused'
  | 'scheduled-task:artifact-save:completed';

export interface ScheduledTaskEventSink {
  emit(event: ScheduledTaskEvent, payload: unknown): void;
}

/** 默认 sink：仅打日志。setGatewayManager 前或无 gateway 时的兜底。 */
export const loggingEventSink: ScheduledTaskEventSink = {
  emit(event, payload) {
    logger.info(`[scheduled-task] event ${event}`, payload);
  },
};

export interface EngineScheduledTaskDispatcherDeps {
  runRepo: ScheduleTaskRunRepository;
  /** service 注入：用于 failurePolicy 命中时 `setEnabled(id, false)` 暂停任务。 */
  taskRepo: ScheduleTaskRepository;
  /** service 注入：返回当前 gatewayManager（未注册时 null，dispatch 直接判失败）。 */
  getGatewayManager: () => GatewayManager | null;
  /** service 注入：烘焙当日占位会话并回 sessionKey（复用 `ensureDatedSessionPlaceholder`）。 */
  ensureDatedSession: (task: ScheduleTask, date: Date) => Promise<{ sessionKey: string }>;
  /** service 注入：构造执行期系统提示追加段（dingtalk "指定即必发" 块）；无收件人→null。 */
  buildSystemPromptAppend: (task: ScheduleTask) => string | null;
  /** service 注入：run 生命周期事件下沉（默认 `loggingEventSink`）。 */
  getEventSink: () => ScheduledTaskEventSink;
}

export class EngineScheduledTaskDispatcher implements ScheduledTaskDispatcher {
  constructor(private readonly deps: EngineScheduledTaskDispatcherDeps) {}

  async dispatch(params: { task: ScheduleTask; run: ScheduleTaskRun }): Promise<void> {
    const { task, run } = params;

    const gatewayManager = this.deps.getGatewayManager();
    if (!gatewayManager) {
      // gateway 未注册：setup 错误，不走 retry/pause。
      await this.markFailed(run, 'gateway manager not registered', undefined, run.sessionKey ?? undefined);
      return;
    }

    const startedAtMs = Date.now();
    const now = new Date(startedAtMs);

    // run 在 claimRun/createRun 时未带 sessionKey（仅 queued 占位）；dispatch 时再落位。
    let sessionKey = run.sessionKey;
    if (!sessionKey) {
      const session = await this.deps.ensureDatedSession(task, now);
      sessionKey = session.sessionKey;
    }

    await this.deps.runRepo.updateRun(run.runId, {
      status: 'running',
      startedAt: now.toISOString(),
      sessionKey,
    });

    const adapter = getAdapter(task.engineType);
    const ctx: EngineAdapterContext = { gatewayManager };
    const systemPromptAppend = this.deps.buildSystemPromptAppend(task) ?? undefined;
    // message 默认即库内 prompt。Claude：有 append 时再 prepend 进 user message（对齐
    // OpenClaw 可见性；system append 仍保留）。OpenClaw 由 adapter 自行 merge，此处不重复。
    const recipients = resolveScheduledTaskDingTalkRecipients(task);
    const appendText = systemPromptAppend?.trim() || '';
    const message =
      adapter.type === 'claude' && appendText.length > 0
        ? prependSystemPromptAppend(task.prompt, systemPromptAppend)
        : task.prompt;

    logger.info('[scheduled-task] dingtalk message assembled', {
      taskId: task.id,
      runId: run.runId,
      engineType: task.engineType,
      promptChars: task.prompt.length,
      messageChars: message.length,
      recipientCount: recipients?.length ?? 0,
      recipients: (recipients ?? []).map((r) => ({
        type: r.type,
        displayName: r.displayName,
        userId: r.userId,
        openConversationId: r.openConversationId,
      })),
      prompt: task.prompt,
      message,
      systemPromptAppend: systemPromptAppend ?? null,
    });

    const input: MainChatSendInput = {
      sessionKey,
      message,
      deliver: true,
      idempotencyKey: run.idempotencyKey,
      systemPromptAppend,
      permissionProfile: task.permissionProfile ?? undefined,
      engineType: adapter.type,
    };

    try {
      const result = await runMainChatSend(
        gatewayManager,
        input,
        (params, memory) => adapter.prepareMemoryInjection(params, memory),
        (prepared) => adapter.sendMessage(ctx, prepared),
      );

      if (!result.success) {
        const error = result.error ?? 'send returned non-success';
        await this.markFailed(run, error, startedAtMs, sessionKey);
        await this.handleFailure(task, run, error);
        return;
      }

      // sendMessage resolve 只代表 run 启动（claude / openclaw 均为异步推事件）。
      // 不在此置 succeeded——挂 watcher 跟 gateway 事件终态。
      logger.info('[scheduled-task] run started, awaiting terminal', {
        taskId: task.id,
        runId: run.runId,
        engineRunId: result.result?.runId,
      });

      const timeoutMs = task.timeoutSec != null ? task.timeoutSec * 1000 : null;
      attachRunWatcher({
        gatewayManager,
        sessionKey,
        engineType: adapter.type,
        timeoutMs,
        // claude 的 assistant final 全在 notification phase=completed 之前 emit，无尾丢→0；
        // openclaw lifecycle end 常先于尾部 chat，需 150ms 缓冲窗等尾部。
        finalizeDeferMs: adapter.type === 'openclaw' ? 150 : 0,
        onTerminal: (signal) => {
          void this.finalizeRunFromWatcher(task, run, startedAtMs, signal, sessionKey).catch((err) => {
            logger.warn('[scheduled-task] watcher onTerminal handler failed', {
              runId: run.runId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        },
        onTimeout: () => {
          void this.handleTimeout(task, run, startedAtMs, sessionKey, adapter, ctx).catch((err) => {
            logger.warn('[scheduled-task] watcher onTimeout handler failed', {
              runId: run.runId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        },
      });
    } catch (error) {
      // sendMessage 抛错 = launch 失败（claude prepareRuntime / openclaw rpc 前的同步异常）。
      // run 未真正启动，走 markFailed + handleFailure，不挂 watcher。
      const message = error instanceof Error ? error.message : String(error);
      await this.markFailed(run, message, startedAtMs, sessionKey);
      await this.handleFailure(task, run, message);
    }
  }

  private async markFailed(
    run: ScheduleTaskRun,
    error: string,
    startedAtMs: number | undefined,
    sessionKey?: string,
  ): Promise<void> {
    const runtimeResult: ScheduleTaskRuntimeResult | undefined =
      startedAtMs != null
        ? { stopReason: null, isError: true, durationMs: Date.now() - startedAtMs }
        : undefined;
    await this.deps.runRepo.updateRun(run.runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error,
      ...(sessionKey ? { sessionKey } : {}),
      ...(runtimeResult ? { runtimeResult } : {}),
    });
    logger.warn('[scheduled-task] run failed', { runId: run.runId, error });
  }

  /**
   * run 终态失败后的善后：有 retry 余量则排程重试，否则落 failurePolicy。
   * 仅在真实 send 失败路径调用——gateway 未注册的 setup 错误不走此路（避免误暂停好任务）。
   */
  private async handleFailure(
    task: ScheduleTask,
    run: ScheduleTaskRun,
    error: string,
  ): Promise<void> {
    const retryPolicy = task.retryPolicy;
    if (retryPolicy && run.attempt < retryPolicy.maxAttempts) {
      await this.scheduleRetry(task, run);
      return;
    }
    await this.applyFailurePolicy(task, run, error);
  }

  /**
   * watcher `onTerminal` 回调：agent 终态（completed/error/aborted）闭环 run。
   * 经 `finalizeRunIfRunning`（`WHERE status='running'`）防与 reaper 双终态——
   * 若 run 已被 reaper reap 为 timed_out 或本 run 已终态，返回 null 退出不重复 handle。
   */
  private async finalizeRunFromWatcher(
    task: ScheduleTask,
    run: ScheduleTaskRun,
    startedAtMs: number,
    signal: RunWatcherTerminalSignal,
    sessionKey: string,
  ): Promise<void> {
    const isError = signal.isError;
    const status = isError ? 'failed' : 'succeeded';
    const runtimeResult: ScheduleTaskRuntimeResult = {
      stopReason: signal.stopReason,
      isError,
      durationMs: Date.now() - startedAtMs,
    };
    const updated = await this.deps.runRepo.finalizeRunIfRunning(run.runId, {
      status,
      completedAt: new Date().toISOString(),
      runtimeResult,
      ...(isError ? { error: `agent terminal: ${signal.stopReason}` } : {}),
    });
    if (!updated) {
      // reaper 已先 reap（timed_out）或 run 已终态——不重复 handle。
      logger.info('[scheduled-task] watcher terminal lost race (run not running)', {
        runId: run.runId,
      });
      return;
    }
    if (isError) {
      logger.warn('[scheduled-task] run failed (agent terminal)', {
        runId: run.runId,
        stopReason: signal.stopReason,
      });
      await this.handleFailure(task, run, `agent terminal: ${signal.stopReason}`);
      return;
    }
    logger.info('[scheduled-task] run succeeded (agent terminal)', {
      taskId: task.id,
      runId: run.runId,
      stopReason: signal.stopReason,
    });
    void this.saveArtifactsToDataCenter(task, run, sessionKey, signal.lastAssistantText, signal.assistantMessages, startedAtMs).catch((error) => {
      logger.warn('[scheduled-task] data center artifact save failed', {
        taskId: task.id,
        runId: run.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.deps.getEventSink().emit('scheduled-task:run:succeeded', {
      taskId: task.id,
      runId: run.runId,
      attempt: run.attempt,
    });
  }

  private async saveArtifactsToDataCenter(
    task: ScheduleTask,
    run: ScheduleTaskRun,
    sessionKey: string,
    assistantText: string,
    assistantMessages: unknown[],
    runStartedAtMs: number,
  ): Promise<void> {
    const targets = resolveDataCenterTargetsFromUris([
      { uri: task.myArtifactFolderPath, label: '我的产物' },
      { uri: task.sharedArtifactFolderPath, label: '网点共享产物' },
    ]);
    if (targets.length === 0) return;

    const historyMessages = await this.loadHistoryMessagesForArtifactSave(task, sessionKey);
    const collectedArtifacts = await collectArtifactsFromAssistantMessages(
      [...assistantMessages, ...historyMessages],
      assistantText,
    );
    const minArtifactMtimeMs = runStartedAtMs - 5_000;
    const artifacts = collectedArtifacts.filter((artifact) => {
      if (typeof artifact.mtimeMs !== 'number') return true;
      return artifact.mtimeMs >= minArtifactMtimeMs;
    });
    logger.info('[scheduled-task] data center artifact candidates', {
      taskId: task.id,
      runId: run.runId,
      targetCount: targets.length,
      assistantMessageCount: assistantMessages.length,
      historyMessageCount: historyMessages.length,
      collectedArtifactCount: collectedArtifacts.length,
      artifactCount: artifacts.length,
      artifacts: artifacts.map((artifact) => ({ name: artifact.name, filePath: artifact.filePath, mtimeMs: artifact.mtimeMs ?? null })),
    });
    const summary = await syncArtifactsToDataCenter({
      sourceType: 'scheduled_task_artifact',
      sourceId: task.id,
      sourceTitle: task.name,
      runId: run.runId,
      sessionId: sessionKey,
      artifacts,
      targets,
      idempotencyScope: `scheduled-task:${task.id}:${run.runId}`,
    });
    this.deps.getEventSink().emit('scheduled-task:artifact-save:completed', {
      taskId: task.id,
      taskTitle: task.name,
      runId: run.runId,
      sessionKey,
      status: summary.status,
      succeededCount: summary.succeededCount,
      failedCount: summary.failedCount,
      records: summary.records,
    });
  }

  private async loadHistoryMessagesForArtifactSave(
    task: ScheduleTask,
    sessionKey: string,
  ): Promise<unknown[]> {
    const gatewayManager = this.deps.getGatewayManager();
    if (!gatewayManager) return [];

    // Give the adapter/history writer a short window to flush file-card/tool-result metadata.
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    try {
      const adapter = getAdapter(task.engineType);
      const result = await adapter.getHistory({ gatewayManager }, { sessionKey, limit: 1000 });
      if (!result.success) {
        logger.warn('[scheduled-task] artifact history load failed', {
          taskId: task.id,
          sessionKey,
          error: result.error,
        });
        return [];
      }
      const messages = (result.result as { messages?: unknown[] })?.messages;
      return Array.isArray(messages) ? messages : [];
    } catch (error) {
      logger.warn('[scheduled-task] artifact history load threw', {
        taskId: task.id,
        sessionKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * watcher `onTimeout` 回调：timeoutMs 到点、agent 仍未终态。先 `abortRun` 停
   * agent 流式，再 `finalizeRunIfRunning` 落 timed_out + `handleFailure`（retry/pause）。
   * 真超时该走 retry/pause（区别于 reaper 的死跑兜底，后者只落终态不重试）。
   */
  private async handleTimeout(
    task: ScheduleTask,
    run: ScheduleTaskRun,
    startedAtMs: number,
    sessionKey: string,
    adapter: ReturnType<typeof getAdapter>,
    ctx: EngineAdapterContext,
  ): Promise<void> {
    // 先 abort agent（停流式），再落终态。
    await adapter.abortRun(ctx, { sessionKey }).catch((err) => {
      logger.warn('[scheduled-task] abortRun on timeout failed', {
        runId: run.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const updated = await this.deps.runRepo.finalizeRunIfRunning(run.runId, {
      status: 'timed_out',
      completedAt: new Date().toISOString(),
      error: `timeout after ${task.timeoutSec}s`,
      runtimeResult: {
        stopReason: 'timeout',
        isError: true,
        durationMs: Date.now() - startedAtMs,
      },
    });
    if (!updated) {
      // agent 在超时窗内已终态（onTerminal 先赢）或 reaper 已 reap——不重复 handle。
      logger.info('[scheduled-task] watcher timeout lost race (run not running)', {
        runId: run.runId,
      });
      return;
    }
    logger.warn('[scheduled-task] run timed out', {
      taskId: task.id,
      runId: run.runId,
      timeoutSec: task.timeoutSec,
    });
    await this.handleFailure(task, run, `timeout after ${task.timeoutSec}s`);
  }

  /**
   * 排程一次重试：`createRun(triggerSource='recovery', attempt+1)` 落 `queued` 占住
   * lease（防 cron tick 期间并发触发），backoff 后自调度 `dispatch`。
   *
   * 重试 run 的 idempotencyKey 用父 runId 区分，避免跨 firing 的 `attempt` 复用碰撞
   * UNIQUE(task_id, idempotency_key)。lease 已防并发，无需推 task.next_run_at。
   * 进程重启时该 queued 重试会被 `discardMissedOnStartup.cancelAllActiveRuns`
   * 当 stale 清掉——与"关机期间错过不补跑"语义一致。
   */
  private async scheduleRetry(task: ScheduleTask, run: ScheduleTaskRun): Promise<void> {
    const retryPolicy = task.retryPolicy!;
    const nextAttempt = run.attempt + 1;
    const backoffMs = Math.max(0, retryPolicy.backoffSec) * 1000;
    const idempotencyKey = `${task.id}:retry:${nextAttempt}:${run.runId}`;
    let retryRun: ScheduleTaskRun;
    try {
      retryRun = await this.deps.runRepo.createRun({
        taskId: task.id,
        triggerSource: 'recovery',
        scheduledFor: new Date(Date.now() + backoffMs).toISOString(),
        status: 'queued',
        idempotencyKey,
        attempt: nextAttempt,
      });
    } catch (createError) {
      logger.warn('[scheduled-task] retry createRun failed', {
        taskId: task.id,
        runId: run.runId,
        error: createError instanceof Error ? createError.message : String(createError),
      });
      return;
    }
    this.deps.getEventSink().emit('scheduled-task:run:retrying', {
      taskId: task.id,
      runId: retryRun.runId,
      attempt: nextAttempt,
      afterMs: backoffMs,
    });
    logger.info('[scheduled-task] retry scheduled', {
      taskId: task.id,
      runId: retryRun.runId,
      attempt: nextAttempt,
      afterMs: backoffMs,
    });
    setTimeout(() => {
      void this.dispatch({ task, run: retryRun }).catch((dispatchError) => {
        logger.warn('[scheduled-task] retry dispatch failed', {
          taskId: task.id,
          runId: retryRun.runId,
          error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
        });
      });
    }, backoffMs);
  }

  /**
   * 重试耗尽（或无 retry 策略）后落 failurePolicy：发 failed 事件，按
   * `countConsecutiveFailedFirings`（计 firing 不计 retry）判定是否命中
   * `pauseAfterConsecutiveFailures`，命中则 `setEnabled(false)` 暂停并发 paused 事件。
   * task.enabled=0 后 tick 头部 `if(!enabled) continue` 即拒触发，无需另清 next_run_at。
   */
  private async applyFailurePolicy(
    task: ScheduleTask,
    run: ScheduleTaskRun,
    error: string,
  ): Promise<void> {
    this.deps.getEventSink().emit('scheduled-task:run:failed', {
      taskId: task.id,
      runId: run.runId,
      attempt: run.attempt,
      error,
    });
    const failurePolicy = task.failurePolicy;
    if (!failurePolicy) return;
    const consecutive = await this.deps.runRepo.countConsecutiveFailedFirings(task.id);
    if (consecutive >= failurePolicy.pauseAfterConsecutiveFailures) {
      await this.deps.taskRepo.setEnabled(task.id, false);
      this.deps.getEventSink().emit('scheduled-task:task:paused', {
        taskId: task.id,
        consecutiveFailures: consecutive,
        threshold: failurePolicy.pauseAfterConsecutiveFailures,
      });
      logger.warn('[scheduled-task] task paused after consecutive failures', {
        taskId: task.id,
        consecutiveFailures: consecutive,
        threshold: failurePolicy.pauseAfterConsecutiveFailures,
      });
    }
  }
}
