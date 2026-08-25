import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type { DingTalkMention } from '../../../shared/dingtalk-send/dingtalk-mention';
import type { ScheduleTask, ScheduleTaskSyncStatus } from '../models/domain/schedule-task';
import type {
  CreateScheduleTaskInput,
  ListScheduleTasksOptions,
  UpdateScheduleTaskInput,
  UpdateScheduleTaskScheduleStateInput,
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

function mapSyncStatus(raw: unknown): ScheduleTaskSyncStatus {
  return raw === 'done' ? 'done' : 'pending';
}

function mapRow(row: Record<string, unknown>): ScheduleTask {
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    cronExpr: String(row.cron_expr),
    engineType: String(row.engine_type) as ScheduleTask['engineType'],
    prompt: String(row.prompt),
    agentId: String(row.agent_id),
    workflowCode: row.workflow_code == null ? null : String(row.workflow_code),
    skillCode: row.skill_code == null ? null : String(row.skill_code),
    dingtalkRecipients: parseJson<DingTalkMention[]>(row.dingtalk_recipients_json),
    model: row.model == null ? null : String(row.model),
    provider: row.provider == null ? null : String(row.provider),
    accountId: row.account_id == null ? null : String(row.account_id),
    workspacePath: row.workspace_path == null ? null : String(row.workspace_path),
    myArtifactFolderPath:
      row.my_artifact_folder_path == null ? null : String(row.my_artifact_folder_path),
    sharedArtifactFolderPath:
      row.shared_artifact_folder_path == null
        ? null
        : String(row.shared_artifact_folder_path),
    permissionProfile:
      row.permission_profile == null
        ? null
        : (String(row.permission_profile) as ScheduleTask['permissionProfile']),
    timeoutSec: row.timeout_sec == null ? null : Number(row.timeout_sec),
    retryPolicy: parseJson<ScheduleTask['retryPolicy']>(row.retry_policy_json),
    failurePolicy: parseJson<ScheduleTask['failurePolicy']>(row.failure_policy_json),
    extra: parseJson<Record<string, unknown>>(row.extra_json),
    nextRunAt: row.next_run_at == null ? null : String(row.next_run_at),
    lastScheduledFor: row.last_scheduled_for == null ? null : String(row.last_scheduled_for),
    lastRecoveredAt: row.last_recovered_at == null ? null : String(row.last_recovered_at),
    cronExprSnapshot: row.cron_expr_snapshot == null ? null : String(row.cron_expr_snapshot),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    syncStatus: mapSyncStatus(row.sync_status),
    remoteVersion: row.remote_version == null ? null : Number(row.remote_version),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
}

export interface CloudDefinitionUpsertInput {
  id: string;
  name: string;
  enabled: boolean;
  cronExpr: string;
  engineType: ScheduleTask['engineType'];
  prompt: string;
  agentId: string;
  workflowCode: string | null;
  skillCode: string | null;
  dingtalkRecipients: DingTalkMention[] | null;
  model: string | null;
  provider: string | null;
  accountId: string | null;
  workspacePath: string | null;
  myArtifactFolderPath: string | null;
  sharedArtifactFolderPath: string | null;
  permissionProfile: ScheduleTask['permissionProfile'];
  timeoutSec: number | null;
  retryPolicy: ScheduleTask['retryPolicy'];
  failurePolicy: ScheduleTask['failurePolicy'];
  extra: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  remoteVersion: number;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * schedule_tasks 表的 DB 访问层（CRUD + 调度状态）。
 * 业务编排（创建校验 / cron 解析 / lease 单飞）在 ScheduledTaskService。
 */
export class ScheduleTaskRepository {
  async getById(
    id: string,
    options?: { includeDeleted?: boolean },
  ): Promise<ScheduleTask | null> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('schedule_tasks').selectAll().where('id', '=', id);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async list(options: ListScheduleTasksOptions = {}): Promise<ScheduleTask[]> {
    const db = getKyselyDatabase();
    const limit = Math.max(1, options.limit ?? 500);
    const offset = Math.max(0, options.offset ?? 0);
    let query = db.selectFrom('schedule_tasks').selectAll();
    if (options.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    if (options.engineType) {
      query = query.where('engine_type', '=', options.engineType);
    }
    if (options.agentId) {
      query = query.where('agent_id', '=', options.agentId);
    }
    if (options.createdBy !== undefined) {
      if (options.createdBy == null) {
        query = query.where('created_by', 'is', null);
      } else {
        // trim 比较：防御历史写入带空白的工号，与写入侧 normalize 对齐
        query = query.where(sql`trim(created_by)`, '=', options.createdBy.trim());
      }
    }
    if (options.syncStatus) {
      query = query.where('sync_status', '=', options.syncStatus);
    }
    const rows = await query
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
    return rows.map(mapRow);
  }

  async create(input: CreateScheduleTaskInput): Promise<ScheduleTask> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const actor =
      input.actor == null ? null : String(input.actor).trim() || null;
    const id = input.id ?? randomUUID();
    await db
      .insertInto('schedule_tasks')
      .values({
        id,
        name: input.name,
        enabled: input.enabled === false ? 0 : 1,
        cron_expr: input.cronExpr,
        engine_type: input.engineType,
        prompt: input.prompt,
        agent_id: input.agentId,
        workflow_code: input.workflowCode ?? null,
        skill_code: input.skillCode ?? null,
        dingtalk_recipients_json: stringifyJson(input.dingtalkRecipients),
        model: input.model ?? null,
        provider: input.provider ?? null,
        account_id: input.accountId ?? null,
        workspace_path: input.workspacePath ?? null,
        my_artifact_folder_path: input.myArtifactFolderPath ?? null,
        shared_artifact_folder_path: input.sharedArtifactFolderPath ?? null,
        permission_profile: input.permissionProfile ?? null,
        timeout_sec: input.timeoutSec ?? null,
        retry_policy_json: stringifyJson(input.retryPolicy),
        failure_policy_json: stringifyJson(input.failurePolicy),
        extra_json: stringifyJson(input.extra),
        next_run_at: null,
        last_scheduled_for: null,
        last_recovered_at: null,
        cron_expr_snapshot: null,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        sync_status: 'pending',
        remote_version: null,
        created_by: actor,
        updated_by: actor,
      })
      .execute();
    const created = await this.getById(id, { includeDeleted: true });
    if (!created) {
      throw new Error(`ScheduleTaskRepository.create: insert returned no row for id=${id}`);
    }
    return created;
  }

  async update(
    id: string,
    input: UpdateScheduleTaskInput,
  ): Promise<ScheduleTask | null> {
    const existing = await this.getById(id, { includeDeleted: true });
    if (!existing) return null;
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const actorRaw = input.actor !== undefined ? input.actor : existing.createdBy;
    const actor = actorRaw == null ? null : String(actorRaw).trim() || null;
    const createdBy =
      existing.createdBy == null || String(existing.createdBy).trim() === ''
        ? actor
        : existing.createdBy;
    await db
      .updateTable('schedule_tasks')
      .set({
        name: input.name !== undefined ? input.name : existing.name,
        enabled:
          input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
        cron_expr: input.cronExpr !== undefined ? input.cronExpr : existing.cronExpr,
        engine_type: input.engineType !== undefined ? input.engineType : existing.engineType,
        prompt: input.prompt !== undefined ? input.prompt : existing.prompt,
        agent_id: input.agentId !== undefined ? input.agentId : existing.agentId,
        workflow_code:
          input.workflowCode !== undefined ? input.workflowCode : existing.workflowCode,
        skill_code: input.skillCode !== undefined ? input.skillCode : existing.skillCode,
        dingtalk_recipients_json:
          input.dingtalkRecipients !== undefined
            ? stringifyJson(input.dingtalkRecipients)
            : stringifyJson(existing.dingtalkRecipients),
        model: input.model !== undefined ? input.model : existing.model,
        provider: input.provider !== undefined ? input.provider : existing.provider,
        account_id: input.accountId !== undefined ? input.accountId : existing.accountId,
        workspace_path:
          input.workspacePath !== undefined ? input.workspacePath : existing.workspacePath,
        my_artifact_folder_path:
          input.myArtifactFolderPath !== undefined
            ? input.myArtifactFolderPath
            : existing.myArtifactFolderPath,
        shared_artifact_folder_path:
          input.sharedArtifactFolderPath !== undefined
            ? input.sharedArtifactFolderPath
            : existing.sharedArtifactFolderPath,
        permission_profile:
          input.permissionProfile !== undefined
            ? input.permissionProfile
            : existing.permissionProfile,
        timeout_sec: input.timeoutSec !== undefined ? input.timeoutSec : existing.timeoutSec,
        retry_policy_json:
          input.retryPolicy !== undefined
            ? stringifyJson(input.retryPolicy)
            : stringifyJson(existing.retryPolicy),
        failure_policy_json:
          input.failurePolicy !== undefined
            ? stringifyJson(input.failurePolicy)
            : stringifyJson(existing.failurePolicy),
        extra_json:
          input.extra !== undefined ? stringifyJson(input.extra) : stringifyJson(existing.extra),
        updated_at: timestamp,
        updated_by: actor,
        created_by: createdBy,
        sync_status: 'pending',
      })
      .where('id', '=', id)
      .execute();
    return this.getById(id, { includeDeleted: true });
  }

  async softDelete(id: string, actor?: string | null): Promise<void> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const normalizedActor = actor == null ? null : String(actor).trim() || null;
    await db
      .updateTable('schedule_tasks')
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: normalizedActor,
        sync_status: 'pending',
        ...(normalizedActor
          ? {
              created_by: sql<string | null>`CASE
                WHEN created_by IS NULL OR trim(created_by) = '' THEN ${normalizedActor}
                ELSE created_by END`,
            }
          : {}),
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    actor?: string | null,
  ): Promise<ScheduleTask | null> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const normalizedActor = actor == null ? null : String(actor).trim() || null;
    await db
      .updateTable('schedule_tasks')
      .set({
        enabled: enabled ? 1 : 0,
        updated_at: timestamp,
        updated_by: normalizedActor,
        sync_status: 'pending',
        ...(normalizedActor
          ? {
              created_by: sql<string | null>`CASE
                WHEN created_by IS NULL OR trim(created_by) = '' THEN ${normalizedActor}
                ELSE created_by END`,
            }
          : {}),
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
    return this.getById(id);
  }

  async updateScheduleState(
    id: string,
    input: UpdateScheduleTaskScheduleStateInput,
  ): Promise<ScheduleTask | null> {
    const existing = await this.getById(id, { includeDeleted: true });
    if (!existing) return null;
    const db = getKyselyDatabase();
    await db
      .updateTable('schedule_tasks')
      .set({
        next_run_at: input.nextRunAt !== undefined ? input.nextRunAt : existing.nextRunAt,
        last_scheduled_for:
          input.lastScheduledFor !== undefined
            ? input.lastScheduledFor
            : existing.lastScheduledFor,
        last_recovered_at:
          input.lastRecoveredAt !== undefined ? input.lastRecoveredAt : existing.lastRecoveredAt,
        cron_expr_snapshot:
          input.cronExprSnapshot !== undefined
            ? input.cronExprSnapshot
            : existing.cronExprSnapshot,
      })
      .where('id', '=', id)
      .execute();
    return this.getById(id, { includeDeleted: true });
  }

  /**
   * 只补 `created_by IS NULL`（或空白）为当前工号。已有工号的行不动。
   * 同时置 `sync_status=pending`，保证认领后一定进入出队。
   * 返回认领行数。
   */
  async claimNullCreatedBy(userCode: string): Promise<number> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const code = userCode.trim();
    if (!code) return 0;
    const result = await db
      .updateTable('schedule_tasks')
      .set({
        created_by: code,
        updated_by: code,
        updated_at: timestamp,
        sync_status: 'pending',
      })
      .where((eb) => eb.or([eb('created_by', 'is', null), eb(sql`trim(created_by)`, '=', '')]))
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  /**
   * 把历史登录名写成的 `created_by` 刷成当前工号（含软删）。
   * `userName` 空或与工号相同则 0。不碰 NULL/空白（仍走认领）。
   */
  async rewriteLoginNameCreatedBy(userCode: string, userName: string): Promise<number> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const code = userCode.trim();
    const name = userName.trim();
    if (!code || !name || name === code) return 0;
    const result = await db
      .updateTable('schedule_tasks')
      .set({
        created_by: code,
        updated_by: code,
        updated_at: timestamp,
        sync_status: 'pending',
      })
      .where(sql`trim(created_by)`, '=', name)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  /**
   * 单条认领孤儿：仅当该行 created_by 为空/空白时写入工号。
   * 供 trigger 等不走 update 的路径。
   */
  async claimOrphanById(id: string, userCode: string): Promise<boolean> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const code = userCode.trim();
    if (!code) return false;
    const result = await db
      .updateTable('schedule_tasks')
      .set({
        created_by: code,
        updated_by: code,
        updated_at: timestamp,
        sync_status: 'pending',
      })
      .where('id', '=', id)
      .where((eb) => eb.or([eb('created_by', 'is', null), eb(sql`trim(created_by)`, '=', '')]))
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
  }

  /**
   * push 成功回写：始终写 `remote_version`；CAS 通过才 `done`。
   * `updateSyncStatus=false` 时只写 remote_version（云端缺失补齐）。
   * 不改 `updated_at`。
   */
  async applyPushSuccess(
    id: string,
    cloudVersion: number,
    snapshotUpdatedAt: string,
    options?: { updateSyncStatus?: boolean },
  ): Promise<void> {
    const db = getKyselyDatabase();
    const updateSyncStatus = options?.updateSyncStatus !== false;
    await db
      .updateTable('schedule_tasks')
      .set(
        updateSyncStatus
          ? {
              remote_version: cloudVersion,
              sync_status: sql<string>`CASE WHEN updated_at = ${snapshotUpdatedAt} THEN 'done' ELSE sync_status END`,
            }
          : { remote_version: cloudVersion },
      )
      .where('id', '=', id)
      .execute();
  }

  /**
   * 手动 pull：以云端定义为准覆盖本地（不覆盖调度四列；写 remote_version + sync_status=done）。
   */
  async upsertDefinitionFromCloud(input: CloudDefinitionUpsertInput): Promise<ScheduleTask> {
    const existing = await this.getById(input.id, { includeDeleted: true });
    const db = getKyselyDatabase();
    const definition = {
      name: input.name,
      enabled: input.enabled ? 1 : 0,
      cron_expr: input.cronExpr,
      engine_type: input.engineType,
      prompt: input.prompt,
      agent_id: input.agentId,
      workflow_code: input.workflowCode,
      skill_code: input.skillCode,
      dingtalk_recipients_json: stringifyJson(input.dingtalkRecipients),
      model: input.model,
      provider: input.provider,
      account_id: input.accountId,
      workspace_path: input.workspacePath,
      my_artifact_folder_path: input.myArtifactFolderPath,
      shared_artifact_folder_path: input.sharedArtifactFolderPath,
      permission_profile: input.permissionProfile,
      timeout_sec: input.timeoutSec,
      retry_policy_json: stringifyJson(input.retryPolicy),
      failure_policy_json: stringifyJson(input.failurePolicy),
      extra_json: stringifyJson(input.extra),
      created_at: input.createdAt,
      updated_at: input.updatedAt,
      deleted_at: input.deletedAt,
      sync_status: 'done' as const,
      remote_version: input.remoteVersion,
      created_by: input.createdBy,
      updated_by: input.updatedBy,
    };

    if (!existing) {
      await db
        .insertInto('schedule_tasks')
        .values({
          id: input.id,
          ...definition,
          next_run_at: null,
          last_scheduled_for: null,
          last_recovered_at: null,
          cron_expr_snapshot: null,
        })
        .execute();
    } else {
      await db
        .updateTable('schedule_tasks')
        .set(definition)
        .where('id', '=', input.id)
        .execute();
    }

    const saved = await this.getById(input.id, { includeDeleted: true });
    if (!saved) {
      throw new Error(`ScheduleTaskRepository.upsertDefinitionFromCloud: missing id=${input.id}`);
    }
    return saved;
  }
}
