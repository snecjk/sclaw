import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type {
  ArtifactSaveRecord,
  CreateArtifactSaveRecordInput,
  ListArtifactSaveRecordsOptions,
  UpdateArtifactSaveRecordInput,
} from '../../services/data-center-artifact-sync/types';

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: Record<string, unknown>): ArtifactSaveRecord {
  return {
    id: String(row.id),
    sourceType: String(row.source_type) as ArtifactSaveRecord['sourceType'],
    sourceId: String(row.source_id),
    sourceTitle: row.source_title == null ? null : String(row.source_title),
    runId: row.run_id == null ? null : String(row.run_id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    artifactKey: String(row.artifact_key),
    artifactName: String(row.artifact_name),
    localPath: row.local_path == null ? null : String(row.local_path),
    targetUri: String(row.target_uri),
    targetLabel: row.target_label == null ? null : String(row.target_label),
    status: String(row.status) as ArtifactSaveRecord['status'],
    dataCenterEntryId: row.data_center_entry_id == null ? null : String(row.data_center_entry_id),
    dataCenterPathLabel: row.data_center_path_label == null ? null : String(row.data_center_path_label),
    errorCode: row.error_code == null ? null : String(row.error_code),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    version: Number(row.version),
  };
}

export class ArtifactSaveRecordRepository {
  async createOrUpdate(input: CreateArtifactSaveRecordInput): Promise<ArtifactSaveRecord> {
    const existing = await this.findExisting(input);
    if (existing) {
      return this.update(existing.id, {
        status: input.status,
        dataCenterEntryId: input.dataCenterEntryId,
        dataCenterPathLabel: input.dataCenterPathLabel,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      });
    }

    const db = getKyselyDatabase();
    const timestamp = nowIso();
    const id = input.id ?? randomUUID();
    await db
      .insertInto('artifact_save_records')
      .values({
        id,
        source_type: input.sourceType,
        source_id: input.sourceId,
        source_title: input.sourceTitle ?? null,
        run_id: input.runId ?? null,
        session_id: input.sessionId ?? null,
        artifact_key: input.artifactKey,
        artifact_name: input.artifactName,
        local_path: input.localPath ?? null,
        target_uri: input.targetUri,
        target_label: input.targetLabel ?? null,
        status: input.status ?? 'pending',
        data_center_entry_id: input.dataCenterEntryId ?? null,
        data_center_path_label: input.dataCenterPathLabel ?? null,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage ?? null,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      })
      .execute();
    const created = await this.getById(id, { includeDeleted: true });
    if (!created) throw new Error(`ArtifactSaveRecordRepository.create: missing id=${id}`);
    return created;
  }

  async getById(id: string, options?: { includeDeleted?: boolean }): Promise<ArtifactSaveRecord | null> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('artifact_save_records').selectAll().where('id', '=', id);
    if (options?.includeDeleted !== true) query = query.where('deleted_at', 'is', null);
    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async findExisting(input: {
    sourceType: string;
    runId?: string | null;
    artifactKey: string;
    targetUri: string;
  }): Promise<ArtifactSaveRecord | null> {
    if (!input.runId) return null;
    const db = getKyselyDatabase();
    const row = await db
      .selectFrom('artifact_save_records')
      .selectAll()
      .where('source_type', '=', input.sourceType)
      .where('run_id', '=', input.runId)
      .where('artifact_key', '=', input.artifactKey)
      .where('target_uri', '=', input.targetUri)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async update(id: string, input: UpdateArtifactSaveRecordInput): Promise<ArtifactSaveRecord> {
    const existing = await this.getById(id, { includeDeleted: true });
    if (!existing) throw new Error(`Artifact save record "${id}" not found`);
    const db = getKyselyDatabase();
    await db
      .updateTable('artifact_save_records')
      .set({
        status: input.status ?? existing.status,
        data_center_entry_id:
          input.dataCenterEntryId !== undefined ? input.dataCenterEntryId : existing.dataCenterEntryId,
        data_center_path_label:
          input.dataCenterPathLabel !== undefined ? input.dataCenterPathLabel : existing.dataCenterPathLabel,
        error_code: input.errorCode !== undefined ? input.errorCode : existing.errorCode,
        error_message: input.errorMessage !== undefined ? input.errorMessage : existing.errorMessage,
        updated_at: nowIso(),
        version: sql<number>`version + 1`,
      })
      .where('id', '=', id)
      .execute();
    const updated = await this.getById(id, { includeDeleted: true });
    if (!updated) throw new Error(`Artifact save record "${id}" disappeared`);
    return updated;
  }

  async list(options: ListArtifactSaveRecordsOptions = {}): Promise<ArtifactSaveRecord[]> {
    const db = getKyselyDatabase();
    const limit = Math.max(1, options.limit ?? 100);
    const offset = Math.max(0, options.offset ?? 0);
    let query = db.selectFrom('artifact_save_records').selectAll();
    if (options.includeDeleted !== true) query = query.where('deleted_at', 'is', null);
    if (options.sourceType) query = query.where('source_type', '=', options.sourceType);
    if (options.sourceId) query = query.where('source_id', '=', options.sourceId);
    if (options.runId) query = query.where('run_id', '=', options.runId);
    const rows = await query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();
    return rows.map(mapRow);
  }
}
