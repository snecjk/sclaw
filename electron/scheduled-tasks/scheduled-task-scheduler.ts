import { logger } from '../utils/logger';
import { computeNextRunAt } from '../utils/cron-math';
import { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';
import { ScheduleTaskRunRepository } from '../db/repositories/schedule-task-run-repository';
import type {
  ScheduleTask,
  ScheduleTaskRun,
  ScheduleTaskTriggerSource,
} from '../db/models/domain/schedule-task';

/**
 * 统一定时任务调度器（引擎无关）。
 *
 * 泛化自 `ClaudeTaskScheduler`，但调度状态直接落在 `schedule_tasks` 行上
 * （`next_run_at` / `last_scheduled_for` / `last_recovered_at` /
 * `cron_expr_snapshot`），不再依赖独立的 scheduler-state JSON；lease 改用
 * `schedule_task_runs` 行的 `status`（active = queued/running），不再依赖
 * lease_until 表。执行（`runMainChatSend` 等）由 Step 5 注入的 `dispatcher`
 * 承接；本调度器只负责「何时触发 + claim 单飞」，不 await 执行。
 *
 * cron 数学（`computeNextRunAt` / `validateCronExpr`）抽到
 * `electron/utils/cron-math.ts`（croner 包装）；行为与旧 claude 调度器一致
 * （5 字段强制、host-local 时区、Vixie OR、排他 nextRun 等价旧 roundUp+扫描）。
 */

const DEFAULT_TICK_INTERVAL_MS = 30_000;

export interface ScheduledTaskScheduleSnapshot {
  taskId: string;
  nextRunAt: string | null;
}

/**
 * 执行器接口（Step 5 注入）。dispatch 收到一个**已 claim 的 `'queued'` run**，
 * 只负责 `queued → running → terminal` + 实际投递（`runMainChatSend` 等）。
 * 调度器对 dispatch 采用 fire-and-forget：claim 成功即推进 `next_run_at`，
 * 不等待执行返回。
 */
export interface ScheduledTaskDispatcher {
  dispatch(params: { task: ScheduleTask; run: ScheduleTaskRun }): Promise<void>;
}

const noopDispatcher: ScheduledTaskDispatcher = {
  async dispatch({ task }) {
    logger.info('[scheduled-task] dispatch skipped (no executor registered)', {
      taskId: task.id,
    });
  },
};

export class ScheduledTaskScheduler {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly taskRepo: ScheduleTaskRepository = new ScheduleTaskRepository(),
    private readonly runRepo: ScheduleTaskRunRepository = new ScheduleTaskRunRepository(),
    private dispatcher: ScheduledTaskDispatcher = noopDispatcher,
    private readonly tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ) {}

  /**
   * 由 `ScheduledTaskService` 在注入 GatewayManager 后注册真实执行器。
   * 允许 scheduler 在未接线时启动（Step 3），随后由 service 替换 dispatcher。
   * 替换是幂等的；运行中的 dispatch 已 fire-and-forget，不受影响。
   */
  setDispatcher(dispatcher: ScheduledTaskDispatcher): void {
    this.dispatcher = dispatcher;
    logger.info('[scheduled-task] dispatcher registered');
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextTick(0);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 重算各 enabled 任务的 `next_run_at`。
   * cron 被编辑后（`cron_expr_snapshot` 与现 `cron_expr` 不符）或旧 `next_run_at`
   * 已落过去的，重算到未来；否则只要仍在未来就保留（卡片显示与调度都不抖动）。
   * disabled 任务置 `next_run_at = null`。
   */
  async refreshSchedule(now: Date = new Date()): Promise<ScheduledTaskScheduleSnapshot[]> {
    const tasks = await this.taskRepo.list({});
    const snapshots: ScheduledTaskScheduleSnapshot[] = [];

    for (const task of tasks) {
      if (!task.enabled) {
        if (task.nextRunAt != null) {
          await this.taskRepo.updateScheduleState(task.id, {
            nextRunAt: null,
            cronExprSnapshot: task.cronExpr,
          });
        }
        snapshots.push({ taskId: task.id, nextRunAt: null });
        continue;
      }

      const cronChanged = task.cronExprSnapshot !== task.cronExpr;
      const stillFuture = !!task.nextRunAt && new Date(task.nextRunAt).getTime() > now.getTime();
      const nextRunAt =
        stillFuture && !cronChanged ? task.nextRunAt! : computeNextRunAt(task.cronExpr, now);

      if (nextRunAt !== task.nextRunAt || cronChanged) {
        await this.taskRepo.updateScheduleState(task.id, {
          nextRunAt,
          cronExprSnapshot: task.cronExpr,
        });
      }
      snapshots.push({ taskId: task.id, nextRunAt });
    }

    return snapshots;
  }

  /**
   * 启动期清扫：把关机期间错过（含崩溃时正在跑）的任务的 `next_run_at` 推进到未来，
   * 并清掉所有残留 active run（= stale lease）。必须在 start() 之前调用，否则第一个
   * tick 仍会按旧逻辑补跑。返回是否有状态变更。
   *
   * 产品要求：关机期间到达执行时间的任务在开机时丢弃，不补跑；只有 app 运行中到达
   * 执行时间的任务才正常执行。
   */
  async discardMissedOnStartup(now: Date = new Date()): Promise<boolean> {
    const tasks = await this.taskRepo.list({});
    const advancedTaskIds: string[] = [];
    let changed = false;

    for (const task of tasks) {
      if (!task.enabled) continue;
      if (task.nextRunAt && new Date(task.nextRunAt).getTime() <= now.getTime()) {
        await this.taskRepo.updateScheduleState(task.id, {
          nextRunAt: computeNextRunAt(task.cronExpr, now),
          lastRecoveredAt: now.toISOString(),
          cronExprSnapshot: task.cronExpr,
        });
        advancedTaskIds.push(task.id);
        changed = true;
      }
    }

    // 清 stale lease（崩溃/重启残留）：开机时主进程刚起、无任务真在跑，全清安全。
    // 不清的话崩溃任务的下次 claimRun 会被 active-run 检查挡住、tick 噪声。
    const cancelled = await this.runRepo.cancelAllActiveRuns();
    if (cancelled > 0) {
      changed = true;
    }

    if (changed) {
      logger.info('[scheduled-task] discarded missed runs on startup', {
        advancedTaskIds,
        cancelledRuns: cancelled,
      });
    }
    return changed;
  }

  /**
   * 清扫挂起的 `running` run：`started_at + task.timeout_sec` 已过即判 stale
   * （引擎回调丢失、进程未重启但单飞被占），finalize 为 `timed_out` 释放单飞。
   * 镜像 claude 家族的时间 lease 自愈——generic 是 status lease，无 lease_until
   * 自愈，故靠 tick 内主动 reap 兜底。
   *
   * 仅 reap `running`（有 `started_at`）；`queued` 无 startedAt，超时路径不判
   * （崩溃残留由启动期 `cancelAllActiveRuns` 清）。`timeoutSec` 为 null 的任务
   * 无法判定超时→跳过（留待未来 per-task 默认 timeout）。
   *
   * 不走执行器失败重试/pause 路径：执行器持有 event sink 与 recovery 重试编排，
   * scheduler 不耦合。reaped run 计为失败 firing（`countConsecutiveFailedFirings`
   * 把 `timed_out` 计入），pause-on-timeout 留后续扩展。见
   * docs/sqlite/schedule-tasks-step5-handoff.md「已知限制」。
   */
  private async reapStaleRuns(now: Date, tasks: ScheduleTask[]): Promise<number> {
    const activeRuns = await this.runRepo.listActiveRuns();
    if (activeRuns.length === 0) return 0;

    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    let reaped = 0;

    for (const run of activeRuns) {
      if (run.status !== 'running' || run.startedAt == null) continue;
      const task = tasksById.get(run.taskId);
      if (!task || task.timeoutSec == null) continue;

      const startedMs = new Date(run.startedAt).getTime();
      const deadlineMs = startedMs + task.timeoutSec * 1000;
      if (deadlineMs > now.getTime()) continue; // 仍在超时窗口内，不 reap

      // 经 finalizeRunIfRunning：若 run watcher 已先 onTimeout 落了 timed_out
      // （或 agent 终态落了 succeeded/failed），此处 status≠running→返回 null，
      // reaper 不覆盖——双重 finalize 守卫。watcher 在进程内、setTimeout 精确，
      // 正常先赢真超时并走执行器 retry/pause；reaper 是 watcher 丢失/未挂时的
      // 30s tick 兜底，只落终态 + 释放单飞（不走执行器重试/pause）。
      const finalized = await this.runRepo.finalizeRunIfRunning(run.runId, {
        status: 'timed_out',
        completedAt: now.toISOString(),
        error: `run exceeded timeout_sec=${task.timeoutSec} (stale lease reaped by scheduler)`,
        runtimeResult: {
          stopReason: 'timeout',
          isError: true,
          durationMs: now.getTime() - startedMs,
        },
      });
      if (!finalized) continue;
      reaped++;
      logger.warn('[scheduled-task] reaped stale run (timeout)', {
        taskId: run.taskId,
        runId: run.runId,
        startedAt: run.startedAt,
        timeoutSec: task.timeoutSec,
      });
    }
    return reaped;
  }

  /**
   * 单次扫描：对每个 due 的 enabled 任务 claim 一次（单飞）、推进 `next_run_at`、
   * fire-and-forget dispatch。busy（已有 active run）时丢弃该 missed-busy 瞬间、
   * 推进到 now 之后（不堆积）。not-due 且 `next_run_at` 为空时补算（兜底新建任务）。
   */
  async tick(now: Date = new Date()): Promise<void> {
    const tasks = await this.taskRepo.list({});

    // 先于 claim：释放挂起的 stale running run，避免 getActiveRun 永久阻塞
    // 到期任务的后续触发（引擎回调丢失时 status lease 无法自愈）。
    await this.reapStaleRuns(now, tasks);

    for (const task of tasks) {
      if (!task.enabled) continue;

      const currentNext = task.nextRunAt ?? computeNextRunAt(task.cronExpr, now);
      const due = new Date(currentNext).getTime() <= now.getTime();

      if (!due) {
        if (task.nextRunAt == null) {
          await this.taskRepo.updateScheduleState(task.id, {
            nextRunAt: currentNext,
            cronExprSnapshot: task.cronExpr,
          });
        }
        continue;
      }

      const run = await this.claimRun(task, {
        triggerSource: 'schedule',
        scheduledFor: currentNext,
      });
      if (run) {
        const nextNext = computeNextRunAt(task.cronExpr, new Date(currentNext));
        await this.taskRepo.updateScheduleState(task.id, {
          nextRunAt: nextNext,
          lastScheduledFor: currentNext,
          cronExprSnapshot: task.cronExpr,
        });
        this.dispatch({ task, run });
      } else {
        // busy：已有 active run，丢弃该 missed-busy 瞬间，推进到 now 之后防堆积。
        const nextNext = computeNextRunAt(task.cronExpr, now);
        await this.taskRepo.updateScheduleState(task.id, {
          nextRunAt: nextNext,
          cronExprSnapshot: task.cronExpr,
        });
        logger.info('[scheduled-task] tick skipped busy task', { taskId: task.id });
      }
    }
  }

  /**
   * 手动触发：绕过 cron 节奏，立即 claim 一个 `manual` run 并 dispatch。
   * 已有 active run 时抛错（对齐 claude "already running" 语义）。
   */
  async triggerTaskNow(taskId: string, now: Date = new Date()): Promise<ScheduleTaskRun> {
    const task = await this.taskRepo.getById(taskId);
    if (!task) {
      throw new Error(`Scheduled task not found: ${taskId}`);
    }
    const scheduledFor = now.toISOString();
    const run = await this.claimRun(task, { triggerSource: 'manual', scheduledFor });
    if (!run) {
      throw new Error(`Scheduled task ${taskId} already has an active run`);
    }
    this.dispatch({ task, run });
    return run;
  }

  /**
   * claim 单飞：active run 在则返回 null（lease 未释放）；否则建一个 `queued` run。
   * `UNIQUE(task_id, idempotency_key)` 兜底并发竞态——第二个插入会抛、catch 后
   * 返回 null。这是「lease 单飞」的全部实现。
   */
  private async claimRun(
    task: ScheduleTask,
    params: { triggerSource: ScheduleTaskTriggerSource; scheduledFor: string },
  ): Promise<ScheduleTaskRun | null> {
    const activeRun = await this.runRepo.getActiveRun(task.id);
    if (activeRun) {
      return null;
    }
    try {
      return await this.runRepo.createRun({
        taskId: task.id,
        triggerSource: params.triggerSource,
        scheduledFor: params.scheduledFor,
        status: 'queued',
        idempotencyKey: this.buildIdempotencyKey(task.id, params.triggerSource, params.scheduledFor),
        attempt: 1,
      });
    } catch (error) {
      logger.warn('[scheduled-task] claimRun lost race or conflict', {
        taskId: task.id,
        error,
      });
      return null;
    }
  }

  /**
   * schedule 幂等键：`{taskId}:{scheduledFor}`（同一时刻只触发一次）。
   * manual 带额外 `:manual:` 前缀，避免与同一时刻的 schedule 触发互斥
   * （manual 与 schedule 可在同一时刻并存）。
   */
  private buildIdempotencyKey(
    taskId: string,
    triggerSource: ScheduleTaskTriggerSource,
    scheduledFor: string,
  ): string {
    return triggerSource === 'manual'
      ? `${taskId}:manual:${scheduledFor}`
      : `${taskId}:${scheduledFor}`;
  }

  private dispatch(params: { task: ScheduleTask; run: ScheduleTaskRun }): void {
    void this.dispatcher.dispatch(params).catch((error) => {
      logger.warn('[scheduled-task] dispatcher dispatch failed', {
        taskId: params.task.id,
        runId: params.run.runId,
        error,
      });
    });
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        await this.tick(new Date());
      } catch (error) {
        logger.warn('[scheduled-task] scheduler tick failed', error);
      } finally {
        this.scheduleNextTick(this.tickIntervalMs);
      }
    }, delayMs);
  }
}
