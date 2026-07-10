import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type {
  CreateDemoRecordInput,
  ListDemoRecordsOptions,
  UpdateDemoRecordInput,
} from '../models/dto/demo-record.dto';
import type {
  DemoRecord,
  DemoRecordStatus,
} from '../models/domain/demo-record';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeName(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Demo record name is required');
  }
  return normalized;
}

function normalizeStatus(value?: DemoRecordStatus): DemoRecordStatus {
  return value === 'inactive' ? 'inactive' : 'active';
}

// Convert one raw table row into the camelCase domain object used by services.
function mapRow(row: Record<string, unknown>): DemoRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    status: String(row.status) as DemoRecordStatus,
    payload: row.payload_json == null
      ? null
      : JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    version: Number(row.version),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
}

export class DemoRecordRepository {
  async create(input: CreateDemoRecordInput): Promise<DemoRecord> {
    const db = getKyselyDatabase();
    const id = input.id?.trim() || randomUUID();
    const timestamp = nowIso();
    const actor = input.actor ?? null;

    await db
      .insertInto('app_demo_records')
      .values({
        id,
        name: normalizeName(input.name),
        description: input.description ?? null,
        status: normalizeStatus(input.status),
        payload_json: input.payload == null ? null : JSON.stringify(input.payload),
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        created_by: actor,
        updated_by: actor,
      })
      .execute();

    return await this.getByIdOrThrow(id);
  }

  async getById(id: string, options?: { includeDeleted?: boolean }): Promise<DemoRecord | null> {
    const db = getKyselyDatabase();
    let query = db
      .selectFrom('app_demo_records')
      .selectAll()
      .where('id', '=', id);

    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }

    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async getByIdOrThrow(id: string, options?: { includeDeleted?: boolean }): Promise<DemoRecord> {
    const record = await this.getById(id, options);
    if (!record) {
      throw new Error(`Demo record not found: ${id}`);
    }
    return record;
  }

  async list(options?: ListDemoRecordsOptions): Promise<DemoRecord[]> {
    const db = getKyselyDatabase();
    const limit = Math.max(1, options?.limit ?? 50);
    const offset = Math.max(0, options?.offset ?? 0);

    // Start from the broadest query and add filters incrementally.
    let query = db
      .selectFrom('app_demo_records')
      .selectAll();

    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }

    if (options?.status) {
      query = query.where('status', '=', options.status);
    }

    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map(mapRow);
  }

  async update(id: string, input: UpdateDemoRecordInput): Promise<DemoRecord> {
    const existing = await this.getByIdOrThrow(id);
    const db = getKyselyDatabase();

    await db
      .updateTable('app_demo_records')
      .set({
        name: input.name != null ? normalizeName(input.name) : existing.name,
        description: input.description !== undefined ? input.description : existing.description,
        status: input.status != null ? normalizeStatus(input.status) : existing.status,
        payload_json: input.payload !== undefined
          ? (input.payload == null ? null : JSON.stringify(input.payload))
          : (existing.payload == null ? null : JSON.stringify(existing.payload)),
        updated_at: nowIso(),
        deleted_at: null,
        version: sql<number>`version + 1`,
        updated_by: input.actor ?? existing.updatedBy,
      })
      .where('id', '=', id)
      .executeTakeFirst();

    return await this.getByIdOrThrow(id, { includeDeleted: true });
  }

  async softDelete(id: string, actor?: string | null): Promise<boolean> {
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const result = await db
      .updateTable('app_demo_records')
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

  async hardDelete(id: string): Promise<boolean> {
    const db = getKyselyDatabase();
    const result = await db
      .deleteFrom('app_demo_records')
      .where('id', '=', id)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0n) > 0;
  }
}

const demoRecordRepository = new DemoRecordRepository();

export function getDemoRecordRepository(): DemoRecordRepository {
  return demoRecordRepository;
}
