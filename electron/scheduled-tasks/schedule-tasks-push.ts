/**
 * 定时任务云端出队 push（主进程本地逻辑，调度 tick 内 fire-and-forget，绝不 pull）。
 *
 * 调用时机：`startScheduler` 之后的 tick（首轮只跑 cron，第二轮起才出队）。
 * 云端读写走 `listScheduleTasksCloud` / `upsertScheduleTaskCloud`（主进程出站）。
 *
 * 出队规则：
 * - 云端 0 条（含墓碑）→ bootstrap，本地该用户全部行上云（忽略 sync_status）
 * - 云端 ≥1 条 → 只推 pending；云端缺 id 的 done 行单条 backfill（只写 remote_version）
 *
 * 单条串行 POST，成功后 CAS：发出前记下 updated_at，回写时一致才 sync_status=done。
 */

import { logger } from '../utils/logger';
import { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';
import type { ScheduleTask } from '../db/models/domain/schedule-task';
import {
  listScheduleTasksCloud,
  upsertScheduleTaskCloud,
} from './schedule-tasks-cloud-client';
import { toCloudUpsertBody } from './schedule-tasks-cloud-mapper';

/** 正在 POST 的任务 id，防止叠轮 tick 对同一条并发推。 */
const inFlightIds = new Set<string>();

/** 单测可注入 list / upsert / repo。 */
export interface ScheduleTasksPushDeps {
  taskRepo?: ScheduleTaskRepository;
  listCloud?: typeof listScheduleTasksCloud;
  upsertCloud?: typeof upsertScheduleTaskCloud;
}

/**
 * 一轮出队。串行逐条 POST，不挡 UI。
 * @param userCode 当前登录工号；只推 `created_by` 属于该用户的行
 * @returns pushed=走 CAS 的成功数；backfilled=补齐成功数；skipped=失败或 in-flight 跳过
 */
export async function runScheduleTasksPushTick(
  userCode: string,
  deps: ScheduleTasksPushDeps = {},
): Promise<{ pushed: number; backfilled: number; skipped: number }> {
  const code = userCode.trim();
  if (!code) return { pushed: 0, backfilled: 0, skipped: 0 };

  const taskRepo = deps.taskRepo ?? new ScheduleTaskRepository();
  const listCloud = deps.listCloud ?? listScheduleTasksCloud;
  const upsertCloud = deps.upsertCloud ?? upsertScheduleTaskCloud;

  const localRows = await taskRepo.list({
    createdBy: code,
    includeDeleted: true,
    limit: 10_000,
  });
  if (localRows.length === 0) return { pushed: 0, backfilled: 0, skipped: 0 };

  let cloudRows: Awaited<ReturnType<typeof listCloud>>;
  try {
    cloudRows = await listCloud(true);
  } catch (error) {
    logger.warn('[scheduled-task] push tick list cloud failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { pushed: 0, backfilled: 0, skipped: localRows.length };
  }

  const cloudById = new Map(cloudRows.map((row) => [row.id, row]));
  const pending = localRows.filter((row) => row.syncStatus === 'pending');
  const missingDone = localRows.filter(
    (row) => row.syncStatus !== 'pending' && !cloudById.has(row.id),
  );

  const casTargets: ScheduleTask[] = cloudRows.length === 0 ? localRows : pending;
  const backfillTargets: ScheduleTask[] = cloudRows.length === 0 ? [] : missingDone;

  let pushed = 0;
  let backfilled = 0;
  let skipped = 0;

  for (const row of casTargets) {
    const ok = await pushOne(row, {
      taskRepo,
      upsertCloud,
      updateSyncStatus: true,
    });
    if (ok) pushed += 1;
    else skipped += 1;
  }
  for (const row of backfillTargets) {
    const ok = await pushOne(row, {
      taskRepo,
      upsertCloud,
      updateSyncStatus: false,
    });
    if (ok) backfilled += 1;
    else skipped += 1;
  }

  return { pushed, backfilled, skipped };
}

/**
 * 推一条：POST 全量覆盖 → 回写 remote_version；updateSyncStatus 时才按 CAS 置 done。
 * backfill 只补云端缺失，不改 sync_status。失败保持 pending，下轮再试。
 */
async function pushOne(
  row: ScheduleTask,
  params: {
    taskRepo: ScheduleTaskRepository;
    upsertCloud: typeof upsertScheduleTaskCloud;
    updateSyncStatus: boolean;
  },
): Promise<boolean> {
  if (inFlightIds.has(row.id)) return false;
  inFlightIds.add(row.id);
  const snapshotUpdatedAt = row.updatedAt;
  const meta = {
    taskId: row.id,
    name: row.name,
    syncStatus: row.syncStatus,
    remoteVersion: row.remoteVersion,
  };
  try {
    const result = await params.upsertCloud(toCloudUpsertBody(row));
    await params.taskRepo.applyPushSuccess(row.id, result.version, snapshotUpdatedAt, {
      updateSyncStatus: params.updateSyncStatus,
    });
    logger.info('[scheduled-task] push row', { ...meta, cloudVersion: result.version });
    return true;
  } catch (error) {
    logger.warn('[scheduled-task] push row failed', {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    inFlightIds.delete(row.id);
  }
}
