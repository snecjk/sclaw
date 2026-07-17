import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import { DEFAULT_WORKSPACE_ID, type Workspace } from '../models/domain/session-catalog';
import type {
  CreateWorkspaceInput,
  ListWorkspacesOptions,
  UpdateWorkspaceInput,
} from '../models/dto/session-catalog.dto';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeName(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Workspace name is required');
  }
  return normalized;
}

function mapRow(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    name: String(row.name),
    rootPath: String(row.root_path ?? ''),
    isDefault: Number(row.is_default) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    version: Number(row.version),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
}

export class WorkspaceRepository {
  async getDefaultWorkspace(): Promise<Workspace> {
    const workspace = await this.getById(DEFAULT_WORKSPACE_ID);
    if (!workspace) {
      throw new Error(`Default workspace missing: ${DEFAULT_WORKSPACE_ID}`);
    }
    return workspace;
  }

  async getById(id: string, options?: { includeDeleted?: boolean }): Promise<Workspace | null> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('workspaces').selectAll().where('id', '=', id);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async list(options?: ListWorkspacesOptions): Promise<Workspace[]> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('workspaces').selectAll();
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    if (options?.includeDefault === false) {
      query = query.where('is_default', '=', 0);
    }
    const rows = await query
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc')
      .execute();
    return rows.map(mapRow);
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const db = getKyselyDatabase();
    const id = input.id?.trim() || randomUUID();
    const timestamp = nowIso();
    const actor = input.actor ?? null;
    await db
      .insertInto('workspaces')
      .values({
        id,
        name: normalizeName(input.name),
        root_path: input.rootPath.trim(),
        is_default: 0,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        created_by: actor,
        updated_by: actor,
      })
      .execute();
    return await this.getByIdOrThrow(id);
  }

  async getByIdOrThrow(id: string, options?: { includeDeleted?: boolean }): Promise<Workspace> {
    const workspace = await this.getById(id, options);
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }
    return workspace;
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    if (id === DEFAULT_WORKSPACE_ID) {
      throw new Error('Default workspace cannot be updated');
    }
    const existing = await this.getByIdOrThrow(id);
    const db = getKyselyDatabase();
    await db
      .updateTable('workspaces')
      .set({
        name: input.name != null ? normalizeName(input.name) : existing.name,
        root_path: input.rootPath != null ? input.rootPath.trim() : existing.rootPath,
        updated_at: nowIso(),
        updated_by: input.actor ?? existing.updatedBy,
        version: sql<number>`version + 1`,
      })
      .where('id', '=', id)
      .executeTakeFirst();
    return await this.getByIdOrThrow(id);
  }

  async softDelete(id: string, actor?: string | null): Promise<boolean> {
    if (id === DEFAULT_WORKSPACE_ID) {
      throw new Error('Default workspace cannot be deleted');
    }
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const result = await db
      .updateTable('workspaces')
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

const workspaceRepository = new WorkspaceRepository();

export function getWorkspaceRepository(): WorkspaceRepository {
  return workspaceRepository;
}
