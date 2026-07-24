import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type {
  ScheduleTaskRun,
  ScheduleTaskRuntimeResult,
} from '../models/domain/schedule-task';
import type {
  CreateScheduleTaskRunInput,
  ListScheduleTaskRunsOptions,
  UpdateScheduleTaskRunInput,
} from '../models/dto/schedule-task.dto';

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function stringifyJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function mapRow(row: Record<string, unknown>): ScheduleTaskRun {
  return {
    runId: String(row.run_id),
    taskId: String(row.task_id),
    status: String(row.status) as ScheduleTaskRun['status'],
    triggerSource: String(row.trigger_source) as ScheduleTaskRun['triggerSource'],
    scheduledFor: row.scheduled_for == null ? null : String(row.scheduled_for),
    startedAt: row.started_at == null ? null : String(row.started_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    attempt: Number(row.attempt),
    idempotencyKey: String(row.idempotency_key),
    sessionKey: row.session_key == null ? null : String(row.session_key),
    summary: row.summary == null ? null : String(row.summary),
    error: row.error == null ? null : String(row.error),
    runtimeResult: parseJson<ScheduleTaskRuntimeResult>(row.runtime_result_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    version: Number(row.version),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
}

/**
 * schedule_task_runs 表的 DB 访问层。
 * 幂等由唯一索引 idx_schedule_task_runs_idem 在 DB 层兜底；
 * find-then-create 的单飞编排归 Step 3 的 ScheduledTaskService。
 */
export class ScheduleTaskRunRepository {
  async getRun(
    runId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<ScheduleTaskRun | null> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('schedule_task_runs').selectAll().where('run_id', '=', runId);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async getByIdempotencyKey(
    taskId: string,
    idempotencyKey: string,
    options?: { includeDeleted?: boolean },
  ): Promise<ScheduleTaskRun | null> {
    const db = getKyselyDatabase();
    let query = db
      .selectFrom('schedule_task_runs')
      .selectAll()
      .where('task_id', '=', taskId)
      .where('idempotency_key', '=', idempotencyKey);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async listRuns(
    taskId: string,
    options: ListScheduleTaskRunsOptions = {},
  ): Promise<ScheduleTaskRun[]> {
    const db = getKyselyDatabase();
    const limit = Math.max(1, options.limit ?? 50);
    const offset = Math.max(0, options.offset ?? 0);
    let query = db.selectFrom('schedule_task_runs').selectAll().where('task_id', '=', taskId);
    if (options.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
    return rows.map(mapRow);
  }

  async getLatestRun(taskId: string): Promise<ScheduleTaskRun | null> {
    const db = getKyselyDatabase();
    const row = await db
      .selectFrom('schedule_task_runs')
      .selectAll()
      .where('task_id', '=', taskId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  /**
   * Latest non-terminal run for a task (`queued` or `running`). Acts as the
   * lease for single-flight: the scheduler refuses to claim a new run while an
   * active one exists. At startup `discardMissedOnStartup` treats all active
   * runs as stale (process just started, none genuinely in-flight) and cancels
   * them via `cancelAllActiveRuns`.
   */
  async getActiveRun(taskId: string): Promise<ScheduleTaskRun | null> {
    const db = getKyselyDatabase();
    const row = await db
      .selectFrom('schedule_task_runs')
      .selectAll()
      .where('task_id', '=', taskId)
      .where('status', 'in', ['queued', 'running'])
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  /**
   * 全部非终态 run（`queued`/`running`），跨任务，按创建时间升序。
   * 供 scheduler 的 stale-run reaper 查找 `running` 且 `started_at` 已超
   * `task.timeout_sec` 的挂起 run（引擎回调丢失）→ finalize 释放单飞。
   * `queued` 无 `started_at`，超时路径不 reap（启动期 `cancelAllActiveRuns`
   * 兜底崩溃残留）；`getActiveRun` 是按任务查单条，此处按需全量列出。
   */
  async listActiveRuns(): Promise<ScheduleTaskRun[]> {
    const db = getKyselyDatabase();
    const rows = await db
      .selectFrom('schedule_task_runs')
      .selectAll()
      .where('status', 'in', ['queued', 'running'])
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map(mapRow);
  }

  /**
   * 数连续失败的 firing（triggerSource 为 `schedule`/`manual` 的 run），跳过
   * `recovery` 重试 run。从最新 run 倒序遍历，遇到第一个非失败的 firing
   * （succeeded/cancelled/queued/running）即停。
   *
   * 用于 `failurePolicy.pauseAfterConsecutiveFailures` 判定——计 firing 不计 retry：
   * 一次 cron 触发经多次重试仍失败只算 1 个连续失败 firing，避免重试放大计数
   * 让单个坏 firing 就触发 pause。`markFailed` 已把本 run 落为 `failed`，故遍历
   * 包含当前刚失败的 firing。
   */
  async countConsecutiveFailedFirings(taskId: string, windowSize = 100): Promise<number> {
    const runs = await this.listRuns(taskId, { limit: windowSize });
    let count = 0;
    for (const run of runs) {
      if (run.triggerSource === 'recovery') continue;
      if (run.status === 'failed' || run.status === 'timed_out') {
        count++;
        continue;
      }
      break;
    }
    return count;
  }

  /**
   * Cancel every active (`queued`/`running`) run across all tasks. Used at
   * startup to clear stale leases left by a previous process. Returns the
   * number of runs cancelled.
   */
  async cancelAllActiveRuns(actor?: string | null): Promise<number> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const result = await db
      .updateTable('schedule_task_runs')
      .set({
        status: 'cancelled',
        completed_at: timestamp,
        updated_at: timestamp,
        updated_by: actor ?? null,
        version: sql<number>`version + 1`,
      })
      .where('status', 'in', ['queued', 'running'])
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async createRun(input: CreateScheduleTaskRunInput): Promise<ScheduleTaskRun> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const actor = input.actor ?? null;
    const runId = input.runId ?? randomUUID();
    await db
      .insertInto('schedule_task_runs')
      .values({
        run_id: runId,
        task_id: input.taskId,
        status: input.status ?? 'queued',
        trigger_source: input.triggerSource,
        scheduled_for: input.scheduledFor ?? null,
        started_at: input.startedAt ?? null,
        completed_at: null,
        attempt: input.attempt ?? 1,
        idempotency_key: input.idempotencyKey,
        session_key: input.sessionKey ?? null,
        summary: null,
        error: null,
        runtime_result_json: null,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        created_by: actor,
        updated_by: actor,
      })
      .execute();
    const created = await this.getRun(runId, { includeDeleted: true });
    if (!created) {
      throw new Error(
        `ScheduleTaskRunRepository.createRun: insert returned no row for runId=${runId}`,
      );
    }
    return created;
  }

  async updateRun(
    runId: string,
    input: UpdateScheduleTaskRunInput,
  ): Promise<ScheduleTaskRun | null> {
    const existing = await this.getRun(runId, { includeDeleted: true });
    if (!existing) return null;
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    await db
      .updateTable('schedule_task_runs')
      .set({
        status: input.status !== undefined ? input.status : existing.status,
        started_at: input.startedAt !== undefined ? input.startedAt : existing.startedAt,
        completed_at: input.completedAt !== undefined ? input.completedAt : existing.completedAt,
        session_key:
          input.sessionKey !== undefined
            ? input.sessionKey == null
              ? null
              : String(input.sessionKey)
            : existing.sessionKey,
        summary: input.summary !== undefined ? input.summary : existing.summary,
        error: input.error !== undefined ? input.error : existing.error,
        runtime_result_json:
          input.runtimeResult !== undefined
            ? stringifyJson(input.runtimeResult)
            : stringifyJson(existing.runtimeResult),
        updated_at: timestamp,
        updated_by: input.actor ?? existing.createdBy,
        version: sql<number>`version + 1`,
      })
      .where('run_id', '=', runId)
      .execute();
    return this.getRun(runId, { includeDeleted: true });
  }
}
