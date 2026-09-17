import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type { CatalogSession } from '../models/domain/session-catalog';
import type {
  ListCatalogSessionsOptions,
  UpsertCatalogSessionInput,
} from '../models/dto/session-catalog.dto';
import {
  inferSessionCatalogMeta,
  type CatalogSessionType,
} from '../../../shared/session-type';

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: Record<string, unknown>): CatalogSession {
  return {
    workspaceId: String(row.workspace_id),
    sessionKey: String(row.session_key),
    groupId: row.group_id == null ? null : String(row.group_id),
    sessionType: String(row.session_type || 'chat') as CatalogSession['sessionType'],
    taskId: row.task_id == null ? null : String(row.task_id),
    appId: row.app_id == null ? null : String(row.app_id),
    channelType: row.channel_type == null ? null : String(row.channel_type),
    channelId: row.channel_id == null ? null : String(row.channel_id),
    title: row.title == null ? null : String(row.title),
    pinRank: row.pin_rank == null ? null : Number(row.pin_rank),
    sortKey: row.sort_key == null ? null : String(row.sort_key),
    lastActivityAt: row.last_activity_at == null ? null : String(row.last_activity_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    version: Number(row.version),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
}

export class CatalogSessionRepository {
  async getByKey(
    workspaceId: string,
    sessionKey: string,
    options?: { includeDeleted?: boolean },
  ): Promise<CatalogSession | null> {
    const db = getKyselyDatabase();
    let query = db
      .selectFrom('catalog_sessions')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('session_key', '=', sessionKey);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async findBySessionKey(
    sessionKey: string,
    options?: { includeDeleted?: boolean },
  ): Promise<CatalogSession | null> {
    const db = getKyselyDatabase();
    let query = db
      .selectFrom('catalog_sessions')
      .selectAll()
      .where('session_key', '=', sessionKey);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const row = await query
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async findLatestByChannel(input: {
    channelType: string;
    channelId: string;
    sessionKeyPrefix: string;
  }): Promise<CatalogSession | null> {
    const db = getKyselyDatabase();
    const row = await db
      .selectFrom('catalog_sessions')
      .selectAll()
      .where('channel_type', '=', input.channelType)
      .where('channel_id', '=', input.channelId)
      .where('session_key', 'like', `${input.sessionKeyPrefix}%`)
      .where('deleted_at', 'is', null)
      .orderBy('last_activity_at', 'desc')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async list(options: ListCatalogSessionsOptions): Promise<CatalogSession[]> {
    const db = getKyselyDatabase();
    const limit = Math.max(1, options.limit ?? 500);
    const offset = Math.max(0, options.offset ?? 0);
    let query = db
      .selectFrom('catalog_sessions')
      .selectAll()
      .where('workspace_id', '=', options.workspaceId);
    if (options.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    if (options.groupId !== undefined) {
      if (options.groupId === null) {
        query = query.where('group_id', 'is', null);
      } else {
        query = query.where('group_id', '=', options.groupId);
      }
    }
    const rows = await query
      .orderBy(sql`CASE WHEN pin_rank IS NULL THEN 1 ELSE 0 END`, 'asc')
      .orderBy('last_activity_at', 'desc')
      .orderBy('session_key', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();
    return rows.map(mapRow);
  }

  async listAll(options?: { includeDeleted?: boolean }): Promise<CatalogSession[]> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('catalog_sessions').selectAll();
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const rows = await query
      .orderBy(sql`CASE WHEN pin_rank IS NULL THEN 1 ELSE 0 END`, 'asc')
      .orderBy('last_activity_at', 'desc')
      .orderBy('session_key', 'asc')
      .execute();
    return rows.map(mapRow);
  }

  async listAllBindings(): Promise<Array<{ workspaceId: string; sessionKey: string }>> {
    const db = getKyselyDatabase();
    const rows = await db
      .selectFrom('catalog_sessions')
      .select(['workspace_id', 'session_key'])
      .where('deleted_at', 'is', null)
      .execute();
    return rows.map((row) => ({
      workspaceId: String(row.workspace_id),
      sessionKey: String(row.session_key),
    }));
  }

  async moveToWorkspace(
    sessionKey: string,
    targetWorkspaceId: string,
    actor?: string | null,
  ): Promise<CatalogSession> {
    const existing = await this.findBySessionKey(sessionKey, { includeDeleted: true });
    if (existing?.workspaceId === targetWorkspaceId && existing.deletedAt == null) {
      return existing;
    }
    const db = getKyselyDatabase();
    if (existing) {
      await db
        .deleteFrom('catalog_sessions')
        .where('workspace_id', '=', existing.workspaceId)
        .where('session_key', '=', sessionKey)
        .execute();
    }
    const timestamp = nowIso();
    return this.upsert({
      workspaceId: targetWorkspaceId,
      sessionKey,
      title: existing?.title ?? null,
      pinRank: existing?.pinRank ?? null,
      sortKey: existing?.sortKey ?? null,
      groupId: null,
      lastActivityAt: existing?.lastActivityAt ?? timestamp,
      actor,
    });
  }

  async upsert(input: UpsertCatalogSessionInput): Promise<CatalogSession> {
    const db = getKyselyDatabase();
    const existing = await this.getByKey(input.workspaceId, input.sessionKey, { includeDeleted: true });
    const timestamp = nowIso();
    const actor = input.actor ?? null;

    const inferred = inferSessionCatalogMeta(input.sessionKey);
    const sessionType = input.sessionType ?? inferred.sessionType ?? 'chat';
    const taskId = input.taskId ?? inferred.taskId ?? null;
    const appId = input.appId ?? inferred.appId ?? null;

    if (!existing) {
      await db
        .insertInto('catalog_sessions')
        .values({
          workspace_id: input.workspaceId,
          session_key: input.sessionKey,
          group_id: input.groupId ?? null,
          session_type: sessionType,
          task_id: taskId,
          app_id: appId,
          channel_type: input.channelType ?? null,
          channel_id: input.channelId ?? null,
          title: input.title ?? null,
          pin_rank: input.pinRank ?? null,
          sort_key: input.sortKey ?? null,
          last_activity_at: input.lastActivityAt ?? timestamp,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          created_by: actor,
          updated_by: actor,
        })
        .execute();
    } else {
      await db
        .updateTable('catalog_sessions')
        .set({
          group_id: input.groupId !== undefined ? input.groupId : existing.groupId,
          session_type: input.sessionType != null ? input.sessionType : existing.sessionType,
          task_id: input.taskId !== undefined ? input.taskId : existing.taskId,
          app_id: input.appId !== undefined ? input.appId : existing.appId,
          channel_type: input.channelType !== undefined ? input.channelType : existing.channelType,
          channel_id: input.channelId !== undefined ? input.channelId : existing.channelId,
          title: input.title !== undefined ? input.title : existing.title,
          pin_rank: input.pinRank !== undefined ? input.pinRank : existing.pinRank,
          sort_key: input.sortKey !== undefined ? input.sortKey : existing.sortKey,
          last_activity_at: input.lastActivityAt ?? existing.lastActivityAt ?? timestamp,
          updated_at: timestamp,
          updated_by: actor ?? existing.updatedBy,
          deleted_at: null,
          version: sql<number>`version + 1`,
        })
        .where('workspace_id', '=', input.workspaceId)
        .where('session_key', '=', input.sessionKey)
        .executeTakeFirst();
    }

    const row = await this.getByKey(input.workspaceId, input.sessionKey, { includeDeleted: true });
    if (!row) {
      throw new Error(`Catalog session missing after upsert: ${input.workspaceId}/${input.sessionKey}`);
    }
    return row;
  }

  /** 任务改名后同步该任务所有 catalog 行的标题快照（含历史 dated 会话与 NULL 标题行）。 */
  async updateTitlesByTaskId(taskId: string, title: string, actor?: string | null): Promise<number> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const result = await db
      .updateTable('catalog_sessions')
      .set({
        title,
        updated_at: timestamp,
        updated_by: actor ?? null,
        version: sql<number>`version + 1`,
      })
      .where('task_id', '=', taskId)
      .where('session_type', 'in', ['cron', 'claude_task'])
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async softDelete(workspaceId: string, sessionKey: string, actor?: string | null): Promise<boolean> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const result = await db
      .updateTable('catalog_sessions')
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: actor ?? null,
        version: sql<number>`version + 1`,
      })
      .where('workspace_id', '=', workspaceId)
      .where('session_key', '=', sessionKey)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n) > 0;
  }

  /** Soft-delete all non-deleted catalog rows of a given session_type (any workspace). */
  async softDeleteBySessionType(sessionType: CatalogSessionType, actor?: string | null): Promise<number> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const result = await db
      .updateTable('catalog_sessions')
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: actor ?? null,
        version: sql<number>`version + 1`,
      })
      .where('session_type', '=', sessionType)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }
}

const catalogSessionRepository = new CatalogSessionRepository();

export function getCatalogSessionRepository(): CatalogSessionRepository {
  return catalogSessionRepository;
}
