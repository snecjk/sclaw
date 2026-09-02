/**
 * 定时任务云端出队 push（主进程本地逻辑，调度 tick 内 fire-and-forget，绝不 pull）。
 *
 * 调用时机：`startScheduler` 之后的 tick（首轮只跑 cron，第二轮起才出队）。
 * 云端读写走 `listScheduleTasksCloud` / `upsertScheduleTaskCloud`（主进程出站）。
 *
 * 出队规则：
 * - 本地无 `sync_status=pending` → 不 list、不 POST（日常稳态零云端调用）
 * - 有 pending → `GET list?includeDeleted=1`：
 *   - 云端 0 条（含墓碑）→ bootstrap，本地该用户全部行上云（忽略 sync_status）
 *   - 云端 ≥1 条 → 只推 pending
 * - 不做「云端缺 id 的 done 行」轮询 backfill
 *
 * 单条串行 POST，成功后 CAS：发出前记下 updated_at，回写时一致才 sync_status=done。
 *
 * 代价：云端空库 + 本地全是 done、且无 pending 时不会自动灌库；需用户再编辑产生 pending，
 * 或靠 MyTask sync-status / 手动 pull。bootstrap 中途失败的 done 行同理不会自动重推。
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
 * @returns pushed=走 CAS 的成功数；backfilled 恒为 0（已取消轮询 backfill）；skipped=失败或 in-flight 跳过
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

  const pending = localRows.filter((row) => row.syncStatus === 'pending');
  // 无 pending 不打云端：省 list/POST；代价见文件头注释
  if (pending.length === 0) return { pushed: 0, backfilled: 0, skipped: 0 };

  let cloudRows: Awaited<ReturnType<typeof listCloud>>;
  try {
    cloudRows = await listCloud(true);
  } catch (error) {
    logger.warn('[scheduled-task] push tick list cloud failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { pushed: 0, backfilled: 0, skipped: pending.length };
  }

  const targets: ScheduleTask[] = cloudRows.length === 0 ? localRows : pending;
  logger.info('[scheduled-task] push tick', {
    cloudCount: cloudRows.length,
    bootstrap: cloudRows.length === 0,
    pendingCount: pending.length,
    targetCount: targets.length,
  });

  let pushed = 0;
  let skipped = 0;

  for (const row of targets) {
    const ok = await pushOne(row, { taskRepo, upsertCloud });
    if (ok) pushed += 1;
    else skipped += 1;
  }

  return { pushed, backfilled: 0, skipped };
}

/**
 * 推一条：POST 全量覆盖 → 回写 remote_version；CAS 通过才 sync_status=done。
 * 失败保持 pending，下轮再试。
 */
async function pushOne(
  row: ScheduleTask,
  params: {
    taskRepo: ScheduleTaskRepository;
    upsertCloud: typeof upsertScheduleTaskCloud;
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
      updateSyncStatus: true,
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
