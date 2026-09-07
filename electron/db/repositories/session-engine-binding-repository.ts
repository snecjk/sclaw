import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type { SessionEngineBinding } from '../models/domain/session-catalog';
import type {
  ListEngineBindingsOptions,
  UpsertEngineBindingInput,
} from '../models/dto/session-catalog.dto';

function nowIso(): string {
  return new Date().toISOString();
}

function buildExtraJson(input: UpsertEngineBindingInput): string | null {
  const extra: Record<string, unknown> = {};
  if (input.title) extra.title = input.title;
  if (input.archivedClaudeSessionIds?.length) {
    extra.archivedClaudeSessionIds = input.archivedClaudeSessionIds;
  }
  if (input.pendingHistoryBridge) {
    extra.pendingHistoryBridge = input.pendingHistoryBridge;
  }
  if (input.piSessionFile) extra.piSessionFile = input.piSessionFile;
  return Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;
}

function mapRow(row: Record<string, unknown>): SessionEngineBinding {
  return {
    sessionKey: String(row.session_key),
    engineType: String(row.engine_type) as SessionEngineBinding['engineType'],
    agentId: String(row.agent_id),
    engineSessionId: row.engine_session_id == null ? null : String(row.engine_session_id),
    cwd: row.cwd == null ? null : String(row.cwd),
    model: row.model == null ? null : String(row.model),
    provider: row.provider == null ? null : String(row.provider),
    accountId: row.account_id == null ? null : String(row.account_id),
    extra: row.extra_json == null
      ? null
      : JSON.parse(String(row.extra_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    version: Number(row.version),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
}

export { bindingToRegistryEntry } from '../../engines/session-binding-map';

export class SessionEngineBindingRepository {
  async countActive(): Promise<number> {
    const db = getKyselyDatabase();
    const row = await db
      .selectFrom('session_engine_bindings')
      .select(sql<number>`count(*)`.as('count'))
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async getBySessionKey(
    sessionKey: string,
    options?: { includeDeleted?: boolean },
  ): Promise<SessionEngineBinding | null> {
    const db = getKyselyDatabase();
    let query = db
      .selectFrom('session_engine_bindings')
      .selectAll()
      .where('session_key', '=', sessionKey);
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    const row = await query.executeTakeFirst();
    return row ? mapRow(row) : null;
  }

  async list(options?: ListEngineBindingsOptions): Promise<SessionEngineBinding[]> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('session_engine_bindings').selectAll();
    if (options?.includeDeleted !== true) {
      query = query.where('deleted_at', 'is', null);
    }
    if (options?.engineType) {
      query = query.where('engine_type', '=', options.engineType);
    }
    const rows = await query.orderBy('updated_at', 'desc').execute();
    return rows.map(mapRow);
  }

  async upsert(input: UpsertEngineBindingInput): Promise<SessionEngineBinding> {
    const db = getKyselyDatabase();
    const existing = await this.getBySessionKey(input.sessionKey, { includeDeleted: true });
    const timestamp = input.updatedAt != null
      ? new Date(input.updatedAt).toISOString()
      : nowIso();
    const actor = input.actor ?? null;
    const extraJson = buildExtraJson(input);

    if (!existing) {
      await db
        .insertInto('session_engine_bindings')
        .values({
          session_key: input.sessionKey,
          engine_type: input.engineType,
          agent_id: input.agentId,
          engine_session_id: input.sessionId ?? null,
          cwd: input.cwd ?? null,
          model: input.model ?? null,
          provider: input.provider ?? null,
          account_id: input.accountId ?? null,
          extra_json: extraJson,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          created_by: actor,
          updated_by: actor,
        })
        .execute();
    } else {
      await db
        .updateTable('session_engine_bindings')
        .set({
          engine_type: input.engineType,
          agent_id: input.agentId,
          engine_session_id: input.sessionId !== undefined ? (input.sessionId ?? null) : existing.engineSessionId,
          cwd: input.cwd !== undefined ? (input.cwd ?? null) : existing.cwd,
          model: input.model !== undefined ? (input.model ?? null) : existing.model,
          provider: input.provider !== undefined ? (input.provider ?? null) : existing.provider,
          account_id: input.accountId !== undefined ? (input.accountId ?? null) : existing.accountId,
          extra_json: extraJson ?? (existing.extra == null ? null : JSON.stringify(existing.extra)),
          updated_at: timestamp,
          updated_by: actor ?? existing.updatedBy,
          deleted_at: null,
          version: sql<number>`version + 1`,
        })
        .where('session_key', '=', input.sessionKey)
        .executeTakeFirst();
    }

    const binding = await this.getBySessionKey(input.sessionKey, { includeDeleted: true });
    if (!binding) {
      throw new Error(`Engine binding missing after upsert: ${input.sessionKey}`);
    }
    return binding;
  }

  async softDelete(sessionKey: string, actor?: string | null): Promise<SessionEngineBinding | null> {
    const existing = await this.getBySessionKey(sessionKey);
    if (!existing) return null;
    const db = getKyselyDatabase();
    const timestamp = nowIso();
    await db
      .updateTable('session_engine_bindings')
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: actor ?? null,
        version: sql<number>`version + 1`,
      })
      .where('session_key', '=', sessionKey)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return existing;
  }
}

const sessionEngineBindingRepository = new SessionEngineBindingRepository();

export function getSessionEngineBindingRepository(): SessionEngineBindingRepository {
  return sessionEngineBindingRepository;
}
