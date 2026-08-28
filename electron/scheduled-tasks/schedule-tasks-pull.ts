/**
 * 定时任务云端检测 + 手动 pull（主进程本地逻辑，不是 Python 透传）。
 *
 * - sync-status：只比对、不改库。MyTask 进页请求一次，决定是否显示「从云端同步」。
 * - pull：用户点按钮后以云端定义为准覆盖本地（不改调度四列），写 remote_version、sync_status=done。
 * 云端 list 走 `listScheduleTasksCloud`（主进程出站，见 sto-memory-api-fetch）。
 */

import { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';
import type { ScheduleTask } from '../db/models/domain/schedule-task';
import { listScheduleTasksCloud } from './schedule-tasks-cloud-client';
import { cloudRowToLocalDefinition, type CloudScheduleTaskRow } from './schedule-tasks-cloud-mapper';

/** 与云端版本比对结果；`hasCloudUpdates` 为 true 才显示同步按钮。 */
export interface ScheduleTasksSyncStatus {
  hasCloudUpdates: boolean;
  cloudNewerCount: number;
  missingLocalCount: number;
  remoteDeletedCount: number;
  sampleIds: string[];
}

/** 一次手动 pull 的合并计数。 */
export interface ScheduleTasksPullResult {
  inserted: number;
  updated: number;
  tombstoned: number;
  resurrected: number;
  skippedTombstones: number;
}

/** 本地尚未镜像过云端 version 时按 0 比。 */
function remoteVersionOf(task: ScheduleTask | null): number {
  return task?.remoteVersion ?? 0;
}

/**
 * 纯比对：云端 list（含墓碑）vs 本地当前用户行（含软删），用云端 `version` 对本地 `remoteVersion`。
 * 本地 pending、云端更旧或没有 → 不算更新（靠 push）。
 *
 * @param localRows 本地该用户全部行（含软删）
 * @param cloudRows 云端该用户全部行（含墓碑）
 */
export function computeScheduleTasksSyncStatus(
  localRows: ScheduleTask[],
  cloudRows: CloudScheduleTaskRow[],
): ScheduleTasksSyncStatus {
  const localById = new Map(localRows.map((row) => [row.id, row]));
  let cloudNewerCount = 0;
  let missingLocalCount = 0;
  let remoteDeletedCount = 0;
  const sampleIds: string[] = [];

  for (const cloud of cloudRows) {
    const local = localById.get(cloud.id) ?? null;
    const cloudVersion = Number(cloud.version) || 0;
    const localRemote = remoteVersionOf(local);
    const cloudDeleted = cloud.deleted_at != null && String(cloud.deleted_at).length > 0;
    const localDeleted = local?.deletedAt != null;

    // 云端活跃、本地无此 id
    if (!local) {
      if (!cloudDeleted) {
        missingLocalCount += 1;
        sampleIds.push(cloud.id);
      }
      continue;
    }

    // 双方活跃，云端更新
    if (!cloudDeleted && !localDeleted && cloudVersion > localRemote) {
      cloudNewerCount += 1;
      sampleIds.push(cloud.id);
      continue;
    }

    // 云端已软删、本地仍活跃
    if (cloudDeleted && !localDeleted && cloudVersion >= localRemote) {
      remoteDeletedCount += 1;
      sampleIds.push(cloud.id);
      continue;
    }

    // 本地已软删、云端仍活跃 → 可复活
    if (!cloudDeleted && localDeleted && cloudVersion > localRemote) {
      cloudNewerCount += 1;
      sampleIds.push(cloud.id);
    }
  }

  return {
    hasCloudUpdates: cloudNewerCount + missingLocalCount + remoteDeletedCount > 0,
    cloudNewerCount,
    missingLocalCount,
    remoteDeletedCount,
    sampleIds: sampleIds.slice(0, 20),
  };
}

/**
 * 拉本地 + 云端 list 后做 sync-status 比对。不写库。
 * @param userCode 当前登录工号；只比该用户的行
 * @param taskRepo / listCloud 可注入，便于单测
 */
export async function getScheduleTasksSyncStatus(
  userCode: string,
  taskRepo: ScheduleTaskRepository = new ScheduleTaskRepository(),
  listCloud: typeof listScheduleTasksCloud = listScheduleTasksCloud,
): Promise<ScheduleTasksSyncStatus> {
  const [localRows, cloudRows] = await Promise.all([
    taskRepo.list({ createdBy: userCode, includeDeleted: true, limit: 10_000 }),
    listCloud(true),
  ]);
  return computeScheduleTasksSyncStatus(localRows, cloudRows);
}

/**
 * 手动 pull：云端 list（含墓碑）覆盖本地定义；本地 pending 未推改动会被盖掉（产品接受）。
 * 不覆盖调度四列；成功后 remote_version=云端 version、sync_status=done。
 * 本地无 id 且云端是墓碑 → 跳过，不插入。
 * @param userCode 当前登录工号；覆盖后缺 createdBy 时补成该工号
 */
export async function pullScheduleTasksFromCloud(
  userCode: string,
  taskRepo: ScheduleTaskRepository = new ScheduleTaskRepository(),
  listCloud: typeof listScheduleTasksCloud = listScheduleTasksCloud,
): Promise<ScheduleTasksPullResult> {
  const cloudRows = await listCloud(true);
  const localRows = await taskRepo.list({
    createdBy: userCode,
    includeDeleted: true,
    limit: 10_000,
  });
  const localById = new Map(localRows.map((row) => [row.id, row]));

  const result: ScheduleTasksPullResult = {
    inserted: 0,
    updated: 0,
    tombstoned: 0,
    resurrected: 0,
    skippedTombstones: 0,
  };

  for (const cloud of cloudRows) {
    const local = localById.get(cloud.id) ?? null;
    const cloudDeleted = cloud.deleted_at != null && String(cloud.deleted_at).length > 0;

    if (!local && cloudDeleted) {
      result.skippedTombstones += 1;
      continue;
    }

    const definition = cloudRowToLocalDefinition(cloud);
    if (definition.createdBy == null) definition.createdBy = userCode;

    const beforeDeleted = local?.deletedAt != null;
    await taskRepo.upsertDefinitionFromCloud(definition);

    if (!local) {
      result.inserted += 1;
    } else if (cloudDeleted && !beforeDeleted) {
      result.tombstoned += 1;
    } else if (!cloudDeleted && beforeDeleted) {
      result.resurrected += 1;
    } else {
      result.updated += 1;
    }
  }

  return result;
}
