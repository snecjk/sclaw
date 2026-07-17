import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type { SessionGroup } from '../models/domain/session-catalog';
import type {
  CreateSessionGroupInput,
  UpdateSessionGroupInput,
} from '../models/dto/session-catalog.dto';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeName(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Session group name is required');
  }
  return normalized;
}

function mapRow(row: Record<string, unknown>): SessionGroup {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    version: Number(row.version),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
}

export class SessionGroupRepository {
  async getById(id: string, options?: { includeDeleted?: boolean }): Promise<SessionGroup | null> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('session_groups').selectAll().where('id', '=', id);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async listByWorkspace(workspaceId: string, options?: { includeDeleted?: boolean }): Promise<SessionGroup[]> {
    const db = getKyselyDatabase();
    let query = db
      .selectFrom('session_groups')
      .selectAll()
      .where('workspace_id', '=', workspaceId);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const rows = await query
      .orderBy('sort_order', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map(mapRow);
  }

  async create(input: CreateSessionGroupInput): Promise<SessionGroup> {
    const db = getKyselyDatabase();
    const id = input.id?.trim() || randomUUID();
    const timestamp = nowIso();
    const actor = input.actor ?? null;
    await db
      .insertInto('session_groups')
      .values({
        id,
        workspace_id: input.workspaceId,
        name: normalizeName(input.name),
        sort_order: input.sortOrder ?? 0,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        created_by: actor,
        updated_by: actor,
      })
      .execute();
    const group = await this.getById(id);
    if (!group) {
      throw new Error(`Session group not found after create: ${id}`);
    }
    return group;
  }

  async update(id: string, input: UpdateSessionGroupInput): Promise<SessionGroup> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Session group not found: ${id}`);
    }
    const db = getKyselyDatabase();
    await db
      .updateTable('session_groups')
      .set({
        name: input.name != null ? normalizeName(input.name) : existing.name,
        sort_order: input.sortOrder ?? existing.sortOrder,
        updated_at: nowIso(),
        updated_by: input.actor ?? existing.updatedBy,
        version: sql<number>`version + 1`,
      })
      .where('id', '=', id)
      .executeTakeFirst();
    const group = await this.getById(id, { includeDeleted: true });
    if (!group) {
      throw new Error(`Session group not found after update: ${id}`);
    }
    return group;
  }

  async softDelete(id: string, actor?: string | null): Promise<boolean> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const result = await db
      .updateTable('session_groups')
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: actor ?? null,
        version: sql<number>`version + 1`,
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n) > 0;
  }
}

const sessionGroupRepository = new SessionGroupRepository();

export function getSessionGroupRepository(): SessionGroupRepository {
  return sessionGroupRepository;
}
