import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type { DingTalkMention } from '../../../shared/dingtalk-send/dingtalk-mention';
import type { ScheduleTask } from '../models/domain/schedule-task';
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
    version: Number(row.version),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
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
    const actor = input.actor ?? null;
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
    const actor = input.actor ?? existing.createdBy;
    await db
      .updateTable('schedule_tasks')
      .set({
        name: input.name !== undefined ? input.name : existing.name,
        enabled:
          input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
        cron_expr: input.cronExpr !== undefined ? input.cronExpr : existing.cronExpr,
        prompt: input.prompt !== undefined ? input.prompt : existing.prompt,
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
        version: sql<number>`version + 1`,
      })
      .where('id', '=', id)
      .execute();
    return this.getById(id, { includeDeleted: true });
  }

  async softDelete(id: string, actor?: string | null): Promise<void> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    await db
      .updateTable('schedule_tasks')
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: actor ?? null,
        version: sql<number>`version + 1`,
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
    await db
      .updateTable('schedule_tasks')
      .set({
        enabled: enabled ? 1 : 0,
        updated_at: timestamp,
        updated_by: actor ?? null,
        version: sql<number>`version + 1`,
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
    const timestamp = nowIso();
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
        updated_at: timestamp,
        updated_by: input.actor ?? existing.createdBy,
        version: sql<number>`version + 1`,
      })
      .where('id', '=', id)
      .execute();
    return this.getById(id, { includeDeleted: true });
  }
}
