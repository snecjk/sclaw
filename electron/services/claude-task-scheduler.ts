import { logger } from '../utils/logger';
import {
  deleteClaudeScheduledTaskLease,
  listClaudeScheduledTaskDefinitions,
  listClaudeScheduledTaskLeases,
  readClaudeScheduledTaskSchedulerState,
  writeClaudeScheduledTaskSchedulerState,
} from './claude-scheduled-task-store';
import { ClaudeTaskWorker, type ClaudeTaskEventSink } from './claude-task-worker';

const DEFAULT_TICK_INTERVAL_MS = 30_000;
const MAX_SCAN_MINUTES = 366 * 24 * 60;

type CronFieldMatcher = (value: number) => boolean;

export interface ClaudeTaskScheduleSnapshot {
  nextRunAt?: string;
  taskId: string;
}

function parseCronField(field: string, min: number, max: number): CronFieldMatcher {
  const normalized = field.trim();
  if (normalized === '*') {
    return () => true;
  }

  const allowed = new Set<number>();
  for (const segment of normalized.split(',')) {
    const part = segment.trim();
    if (!part) continue;

    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Math.max(1, Number(stepPart)) : 1;
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${part}`);
    }

    let start = min;
    let end = max;
    if (rangePart !== '*') {
      const [rawStart, rawEnd] = rangePart.split('-');
      start = Number(rawStart);
      end = rawEnd != null ? Number(rawEnd) : start;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end) {
      throw new Error(`Invalid cron range: ${part}`);
    }

    for (let value = start; value <= end; value += step) {
      allowed.add(value);
    }
  }

  return (value: number) => allowed.has(value);
}

function parseCronExpression(expr: string): {
  dayOfMonthAny: boolean;
  dayOfMonthMatches: CronFieldMatcher;
  dayOfWeekAny: boolean;
  dayOfWeekMatches: CronFieldMatcher;
  hourMatches: CronFieldMatcher;
  minuteMatches: CronFieldMatcher;
  monthMatches: CronFieldMatcher;
} {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected 5-field cron expression, received: ${expr}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return {
    dayOfMonthAny: dayOfMonth === '*',
    dayOfMonthMatches: parseCronField(dayOfMonth, 1, 31),
    dayOfWeekAny: dayOfWeek === '*',
    dayOfWeekMatches: parseCronField(dayOfWeek, 0, 6),
    hourMatches: parseCronField(hour, 0, 23),
    minuteMatches: parseCronField(minute, 0, 59),
    monthMatches: parseCronField(month, 1, 12),
  };
}

function matchesCron(date: Date, expr: string): boolean {
  const parsed = parseCronExpression(expr);
  if (!parsed.minuteMatches(date.getMinutes())) return false;
  if (!parsed.hourMatches(date.getHours())) return false;
  if (!parsed.monthMatches(date.getMonth() + 1)) return false;

  const domMatches = parsed.dayOfMonthMatches(date.getDate());
  const dowMatches = parsed.dayOfWeekMatches(date.getDay());
  if (parsed.dayOfMonthAny && parsed.dayOfWeekAny) return true;
  if (parsed.dayOfMonthAny) return dowMatches;
  if (parsed.dayOfWeekAny) return domMatches;
  return domMatches || dowMatches;
}

function roundUpToNextMinute(date: Date): Date {
  const next = new Date(date.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  return next;
}

export function computeNextRunAt(expr: string, from: Date): string {
  let candidate = roundUpToNextMinute(from);
  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    if (matchesCron(candidate, expr)) {
      return candidate.toISOString();
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new Error(`Could not find next run time within scan horizon for cron: ${expr}`);
}

export class ClaudeTaskScheduler {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly worker = new ClaudeTaskWorker(),
    private readonly tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
  ) {}

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

  /** Forward the gateway event sink so worker runs can stream to the renderer. */
  setEventSink(sink: ClaudeTaskEventSink | null): void {
    this.worker.setEventSink(sink);
  }

  async triggerTaskNow(taskId: string): Promise<Awaited<ReturnType<ClaudeTaskWorker['startTask']>>> {
    return this.worker.startTask({
      taskId,
      triggerSource: 'manual',
    });
  }

  async refreshSchedule(now = new Date()): Promise<ClaudeTaskScheduleSnapshot[]> {
    const definitions = await listClaudeScheduledTaskDefinitions();
    const state = await readClaudeScheduledTaskSchedulerState();
    const nextTasks = { ...(state.tasks ?? {}) };
    const snapshots: ClaudeTaskScheduleSnapshot[] = [];

    for (const definition of definitions) {
      if (!definition.enabled) continue;
      const existing = nextTasks[definition.id];
      const nextRunAt = existing?.nextRunAt && new Date(existing.nextRunAt).getTime() > now.getTime()
        ? existing.nextRunAt
        : computeNextRunAt(definition.cronExpr, now);
      nextTasks[definition.id] = {
        ...existing,
        nextRunAt,
      };
      snapshots.push({
        taskId: definition.id,
        nextRunAt,
      });
    }

    await writeClaudeScheduledTaskSchedulerState({
      lastTickAt: now.toISOString(),
      tasks: nextTasks,
    });
    return snapshots;
  }

  /**
   * 启动期清扫：把关机期间错过（含崩溃时正在跑）的任务的 nextRunAt 推进到未来，
   * 并清掉崩溃任务残留的 stale lease。必须在 start() 之前调用，否则第一个 tick
   * 仍会按旧逻辑补跑。返回是否有状态变更。
   *
   * 产品要求：关机期间到达执行时间的任务在开机时丢弃，不补跑；
   * 只有 app 运行中到达执行时间的任务才正常执行。
   */
  async discardMissedOnStartup(now = new Date()): Promise<boolean> {
    const definitions = await listClaudeScheduledTaskDefinitions();
    const state = await readClaudeScheduledTaskSchedulerState();
    const defById = new Map(definitions.map((definition) => [definition.id, definition]));
    const nextTasks = { ...(state.tasks ?? {}) };
    let changed = false;
    const advancedTaskIds: string[] = [];
    const clearedLeaseTaskIds: string[] = [];

    for (const [id, taskState] of Object.entries(nextTasks)) {
      const def = defById.get(id);
      if (!def?.enabled) continue;
      const nextRunAt = taskState.nextRunAt;
      // nextRunAt 落在过去 = 关机期间错过，或崩溃时正在跑（崩溃时 post-run 的
      // nextRunAt 推进从未落盘，故仍停在过去的触发时刻）。两种情况都丢弃、重算到未来。
      if (nextRunAt && new Date(nextRunAt).getTime() <= now.getTime()) {
        nextTasks[id] = {
          ...taskState,
          nextRunAt: computeNextRunAt(def.cronExpr, now),
        };
        advancedTaskIds.push(id);
        changed = true;
      }
    }

    // 清 stale lease（崩溃任务残留）：开机时主进程刚起、无任务真在跑，全清安全。
    // 不清的话崩溃任务的下次 runTask 会被 prepareRun 的 leaseUntil > now 判断挡住、
    // 抛 "already running" → tick 崩。
    const leases = await listClaudeScheduledTaskLeases();
    for (const lease of leases) {
      if (new Date(lease.leaseUntil).getTime() > now.getTime()) {
        await deleteClaudeScheduledTaskLease(lease.taskId);
        clearedLeaseTaskIds.push(lease.taskId);
        changed = true;
      }
    }

    if (changed) {
      await writeClaudeScheduledTaskSchedulerState({
        lastTickAt: now.toISOString(),
        tasks: nextTasks,
      });
      logger.info('[claude-task] discarded missed runs on startup', {
        advancedTaskIds,
        clearedLeaseTaskIds,
      });
    }
    return changed;
  }

  async tick(now = new Date()): Promise<void> {
    const definitions = await listClaudeScheduledTaskDefinitions();
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const state = await readClaudeScheduledTaskSchedulerState();
    const nextTasks = { ...(state.tasks ?? {}) };

    for (const definition of definitions) {
      if (!definition.enabled) continue;
      const taskState = nextTasks[definition.id] ?? {};
      const nextRunAt = taskState.nextRunAt ?? computeNextRunAt(definition.cronExpr, now);
      const due = new Date(nextRunAt).getTime() <= now.getTime();

      if (due) {
        logger.info('[claude-task] scheduler dispatching due task', { taskId: definition.id, nextRunAt });
        await this.worker.runTask({
          scheduledFor: nextRunAt,
          taskId: definition.id,
          triggerSource: 'schedule',
        });
        const baseline = new Date(nextRunAt);
        nextTasks[definition.id] = {
          lastRecoveredAt: taskState.lastRecoveredAt,
          lastScheduledFor: nextRunAt,
          nextRunAt: computeNextRunAt(definition.cronExpr, baseline),
        };
      } else {
        nextTasks[definition.id] = {
          ...taskState,
          nextRunAt,
        };
      }
    }

    for (const taskId of Object.keys(nextTasks)) {
      if (!definitionsById.has(taskId) || !definitionsById.get(taskId)?.enabled) {
        delete nextTasks[taskId];
      }
    }

    await writeClaudeScheduledTaskSchedulerState({
      lastTickAt: now.toISOString(),
      tasks: nextTasks,
    });
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        await this.tick(new Date());
      } catch (error) {
        logger.warn('[claude-task] scheduler tick failed', error);
      } finally {
        this.scheduleNextTick(this.tickIntervalMs);
      }
    }, delayMs);
  }
}
