/**
 * Scheduled Task Result Poller
 *
 * Polls the cloud Scheduled Tasks API for new execution results and appends
 * them to local sessions. Runs in the Main process with a serial queue to
 * avoid concurrent requests.
 */

import type { BrowserWindow } from 'electron';
import { getScheduledTaskService, type ScheduledTask, type ScheduledTaskRun } from './scheduled-task-service';
import { appendTriggerResultToSession } from './scheduled-task-session-writer';
import {
  getLastSyncTime,
  setLastSyncTime,
  getLastPolledAt,
  setLastPolledAt,
  isRunProcessed,
  markRunProcessed,
} from '../utils/scheduled-task-poller-store';
import { logger } from '../utils/logger';

const BASE_INTERVAL_MS = 30000;
const MAX_BACKOFF_MS = 300000;
const TASK_POLL_INTERVAL_MS = 5000;
const TASK_POLL_MAX_DURATION_MS = 120000;
const IDLE_INTERVAL_MS = 5 * 60 * 1000;   // 无活跃任务时全局轮询间隔
const WARM_INTERVAL_MS = 2 * 60 * 1000;   // 任务在1小时内执行时间隔

export class ScheduledTaskResultPoller {
  private globalTimer: NodeJS.Timeout | null = null;
  private activeTaskTimers = new Map<number, NodeJS.Timeout>();
  private isRunning = false;
  private mainWindow: BrowserWindow | null = null;
  private currentInterval = BASE_INTERVAL_MS;

  attachMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentInterval = BASE_INTERVAL_MS;
    this.scheduleGlobalTick(0);
  }

  stop() {
    this.isRunning = false;
    if (this.globalTimer) {
      clearTimeout(this.globalTimer);
      this.globalTimer = null;
    }
    for (const timer of Array.from(this.activeTaskTimers.values())) {
      clearTimeout(timer);
    }
    this.activeTaskTimers.clear();
  }

  /**
   * Start high-frequency polling for a specific task (e.g. after manual trigger).
   */
  startTaskPoll(taskId: number) {
    this.stopTaskPoll(taskId);
    const startTime = Date.now();
    let attempt = 0;

    const poll = async () => {
      if (!this.isRunning || Date.now() - startTime > TASK_POLL_MAX_DURATION_MS) {
        this.stopTaskPoll(taskId);
        return;
      }

      try {
        const service = getScheduledTaskService();
        const task = await service.getTaskDetails(taskId);
        const hasNew = await this.syncTaskResults(task);
        if (hasNew) {
          this.stopTaskPoll(taskId);
          return;
        }
      } catch (err) {
        logger.error(`[ScheduledTaskPoller] Task poll ${taskId} error:`, err);
      }

      attempt++;
      const nextInterval = attempt < 5 ? TASK_POLL_INTERVAL_MS : TASK_POLL_INTERVAL_MS * 2;
      const timer = setTimeout(poll, nextInterval);
      this.activeTaskTimers.set(taskId, timer);
    };

    poll();
  }

  stopTaskPoll(taskId: number) {
    const timer = this.activeTaskTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.activeTaskTimers.delete(taskId);
    }
  }

  private scheduleGlobalTick(delay: number) {
    if (!this.isRunning) return;
    this.globalTimer = setTimeout(() => this.runGlobalTick(), delay);
  }

  private async runGlobalTick() {
    if (!this.isRunning) return;

    try {
      const service = getScheduledTaskService();
      const tasks = await service.listTasks();
      const hasNew = await this.syncAllResults(tasks);
      if (hasNew) {
        this.currentInterval = BASE_INTERVAL_MS;
      } else {
        this.currentInterval = this.calculateNextInterval(tasks);
      }
      this.scheduleGlobalTick(this.currentInterval);
    } catch (err) {
      logger.warn('[ScheduledTaskPoller] Global tick error:', err);
      this.currentInterval = Math.min(this.currentInterval * 2, MAX_BACKOFF_MS);
      this.scheduleGlobalTick(this.currentInterval);
    }
  }

  /**
   * 根据所有任务的 nextRunAt 动态计算下次全局 tick 间隔。
   * 无近期执行的任务 → 5分钟；1小时内 → 2分钟；10分钟内 → 30秒。
   */
  private calculateNextInterval(tasks: ScheduledTask[]): number {
    const now = Date.now();
    let minDistance = Infinity;

    for (const task of tasks) {
      if (!task.enabled) continue;
      if (task.nextRunAt) {
        const nextRun = new Date(task.nextRunAt).getTime();
        // 包括刚执行完 5 分钟内的情况（nextRun 可能刚过去）
        if (nextRun > now - 5 * 60 * 1000) {
          minDistance = Math.min(minDistance, Math.abs(nextRun - now));
        }
      }
    }

    if (minDistance === Infinity) return IDLE_INTERVAL_MS;
    if (minDistance > 60 * 60 * 1000) return IDLE_INTERVAL_MS;
    if (minDistance > 10 * 60 * 1000) return WARM_INTERVAL_MS;
    return BASE_INTERVAL_MS;
  }

  private async syncAllResults(tasks: ScheduledTask[]): Promise<boolean> {
    const lastSyncTime = await getLastSyncTime();
    let hasNewOverall = false;

    for (const task of tasks) {
      if (!this.isRunning) break;
      if (!task.enabled) continue;

      const taskLastPolled = await getLastPolledAt(task.id);
      const taskLastRunAt = task.lastRunAt;

      // Skip if no new run since last poll
      if (taskLastPolled && taskLastRunAt && new Date(taskLastRunAt) <= new Date(taskLastPolled)) {
        continue;
      }

      // Skip if lastRunAt is older than global lastSyncTime
      if (lastSyncTime && taskLastRunAt && new Date(taskLastRunAt) <= new Date(lastSyncTime)) {
        continue;
      }

      try {
        const hasNew = await this.syncTaskResults(task);
        if (hasNew) hasNewOverall = true;
      } catch (err) {
        logger.warn(`[ScheduledTaskPoller] Failed to sync task ${task.id}:`, err);
      }
    }

    if (hasNewOverall) {
      await setLastSyncTime(new Date().toISOString());
    }
    return hasNewOverall;
  }

  private async syncTaskResults(task: ScheduledTask): Promise<boolean> {
    const taskId = task.id;

    try {
      const service = getScheduledTaskService();
      const runs = await service.queryTaskRuns(taskId);

      if (!runs || runs.length === 0) {
        await setLastPolledAt(taskId, new Date().toISOString());
        return false;
      }

      const newRuns: ScheduledTaskRun[] = [];
      for (const run of runs) {
        const dedupeKey = `${taskId}:${run.id}`;
        if (await isRunProcessed(dedupeKey)) {
          continue;
        }

        // 跳过仍在执行中的 run，pending 状态不推送也不标记为已处理
        if (run.status === 'pending') {
          continue;
        }

        await appendTriggerResultToSession(taskId, task.name, {
          status: run.status,
          executionResult: run.executionResult,
          logText: run.logText,
        });

        await markRunProcessed(dedupeKey);
        newRuns.push(run);
      }

      await setLastPolledAt(taskId, new Date().toISOString());

      if (newRuns.length > 0) {
        this.notifyRenderer(taskId, task.name, newRuns);
        return true;
      }
      return false;
    } catch (err) {
      logger.warn(`[ScheduledTaskPoller] Failed to sync task ${taskId}:`, err);
      await setLastPolledAt(taskId, new Date().toISOString());
      return false;
    }
  }

  private notifyRenderer(taskId: number, taskName: string, runs: ScheduledTaskRun[]) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('scheduled-task:new-result', {
      taskId,
      taskName,
      runs: runs.map((r) => ({
        runId: r.id,
        status: r.status,
      })),
    });
  }
}

let pollerInstance: ScheduledTaskResultPoller | null = null;

export function getScheduledTaskResultPoller(): ScheduledTaskResultPoller {
  if (!pollerInstance) {
    pollerInstance = new ScheduledTaskResultPoller();
  }
  return pollerInstance;
}
