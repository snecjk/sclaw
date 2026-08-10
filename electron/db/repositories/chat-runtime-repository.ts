import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { ChatRuntimeSnapshot, ChatRunPhase } from '../../../shared/chat-runtime-protocol';
import { isTerminalChatRunPhase } from '../../../shared/chat-runtime-protocol';
import { getKyselyDatabase } from '../connection';

const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS = 500;

function safeParseJson(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function safeStringifyJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function mapRow(row: Record<string, unknown>): ChatRuntimeSnapshot {
  return {
    protocolVersion: 1,
    sessionKey: String(row.session_key),
    runId: row.run_id == null ? null : String(row.run_id),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    runtimePolicy: {
      origin: row.origin === 'scheduled_task' || row.origin === 'channel' ? row.origin : 'interactive',
      ownerId: row.owner_id == null ? undefined : String(row.owner_id),
      deadlineAt: row.deadline_at == null ? null : Number(row.deadline_at),
    },
    engineType: String(row.engine_type) === 'claude' ? 'claude' : 'openclaw',
    phase: String(row.phase) as ChatRunPhase,
    epoch: Number(row.epoch),
    sequence: Number(row.sequence),
    startedAt: Number(row.started_at),
    lastEventAt: Number(row.last_event_at),
    terminalAt: row.terminal_at == null ? null : Number(row.terminal_at),
    error: row.error == null ? null : String(row.error),
    acceptanceResult: safeParseJson(row.acceptance_result_json == null ? null : String(row.acceptance_result_json)),
    updatedAt: Date.parse(String(row.updated_at)) || Number(row.last_event_at),
  };
}

export class ChatRuntimeRepository {
  async getLatestForSession(sessionKey: string): Promise<ChatRuntimeSnapshot | null> {
    const row = await getKyselyDatabase()
      .selectFrom('chat_runtime_runs')
      .selectAll()
      .where('session_key', '=', sessionKey)
      .orderBy('updated_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  async getByIdempotencyKey(sessionKey: string, idempotencyKey: string): Promise<ChatRuntimeSnapshot | null> {
    const row = await getKyselyDatabase()
      .selectFrom('chat_runtime_runs')
      .selectAll()
      .where('session_key', '=', sessionKey)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  async getByOwner(origin: ChatRuntimeSnapshot['runtimePolicy']['origin'], ownerId: string): Promise<ChatRuntimeSnapshot | null> {
    const row = await getKyselyDatabase()
      .selectFrom('chat_runtime_runs')
      .selectAll()
      .where('origin', '=', origin)
      .where('owner_id', '=', ownerId)
      .orderBy('updated_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  async listActive(): Promise<ChatRuntimeSnapshot[]> {
    const rows = await getKyselyDatabase()
      .selectFrom('chat_runtime_runs')
      .selectAll()
      .where('phase', 'in', [
        'dispatching', 'uncertain', 'running', 'awaiting_transcript', 'aborting', 'reconciling',
      ])
      .orderBy('updated_at', 'asc')
      .execute();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  }

  async upsertIfNewer(snapshot: ChatRuntimeSnapshot): Promise<'inserted' | 'updated' | 'stale' | 'unchanged'> {
    const db = getKyselyDatabase();
    const idempotencyKey = snapshot.idempotencyKey ?? `runtime-${snapshot.sessionKey}-${snapshot.startedAt}`;
    // Records and test fixtures created before protocol policy fields existed must
    // remain writable during the compatibility window.
    const runtimePolicy = snapshot.runtimePolicy ?? {
      origin: 'interactive' as const,
      deadlineAt: null,
    };
    const timestamp = new Date(snapshot.updatedAt).toISOString();
    const values = {
      id: randomUUID(),
      session_key: snapshot.sessionKey,
      run_id: snapshot.runId,
      idempotency_key: idempotencyKey,
      origin: runtimePolicy.origin,
      owner_id: runtimePolicy.ownerId ?? null,
      deadline_at: runtimePolicy.deadlineAt ?? null,
      engine_type: snapshot.engineType,
      phase: snapshot.phase,
      epoch: snapshot.epoch,
      sequence: snapshot.sequence,
      started_at: snapshot.startedAt,
      last_event_at: snapshot.lastEventAt,
      terminal_at: snapshot.terminalAt,
      error: snapshot.error,
      acceptance_result_json: safeStringifyJson(snapshot.acceptanceResult),
      created_at: timestamp,
      updated_at: timestamp,
    };

    return db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom('chat_runtime_runs')
        .selectAll()
        .where('session_key', '=', snapshot.sessionKey)
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();
      if (!row) {
        await trx.insertInto('chat_runtime_runs').values(values).execute();
        return 'inserted';
      }

      const existingEpoch = Number(row.epoch);
      const existingSequence = Number(row.sequence);
      if (existingEpoch > snapshot.epoch || (
        existingEpoch === snapshot.epoch && existingSequence > snapshot.sequence
      )) return 'stale';

      if (existingEpoch === snapshot.epoch && existingSequence === snapshot.sequence) {
        if (String(row.phase) !== snapshot.phase) return 'stale';
        const metadataChanged = row.run_id !== values.run_id
          || row.acceptance_result_json !== values.acceptance_result_json
          || row.error !== values.error;
        if (!metadataChanged) return 'unchanged';
        await trx.updateTable('chat_runtime_runs').set({
          run_id: values.run_id,
          acceptance_result_json: values.acceptance_result_json,
          error: values.error,
          updated_at: timestamp,
          version: sql<number>`version + 1`,
        }).where('id', '=', row.id).execute();
        return 'updated';
      }

      await trx.updateTable('chat_runtime_runs').set({
        run_id: values.run_id,
        origin: values.origin,
        owner_id: values.owner_id,
        deadline_at: values.deadline_at,
        phase: values.phase,
        epoch: values.epoch,
        sequence: values.sequence,
        last_event_at: values.last_event_at,
        terminal_at: values.terminal_at,
        error: values.error,
        acceptance_result_json: values.acceptance_result_json,
        updated_at: timestamp,
        version: sql<number>`version + 1`,
      }).where('id', '=', row.id).execute();
      return 'updated';
    });
  }

  async upsert(snapshot: ChatRuntimeSnapshot): Promise<void> {
    await this.upsertIfNewer(snapshot);
  }

  async prune(now = Date.now()): Promise<void> {
    const db = getKyselyDatabase();
    const cutoff = now - TERMINAL_RETENTION_MS;
    await db.deleteFrom('chat_runtime_runs')
      .where('terminal_at', 'is not', null)
      .where('terminal_at', '<', cutoff)
      .execute();

    const overflow = await db.selectFrom('chat_runtime_runs')
      .select('id')
      .where('phase', 'in', ['completed', 'failed', 'aborted', 'interrupted'])
      .orderBy('updated_at', 'desc')
      // SQLite does not allow a bare OFFSET. LIMIT -1 means "all remaining
      // rows" while retaining the intended top-500 terminal records.
      .limit(-1)
      .offset(MAX_RECORDS)
      .execute();
    if (overflow.length > 0) {
      await db.deleteFrom('chat_runtime_runs')
        .where('id', 'in', overflow.map((row) => row.id))
        .execute();
    }
  }

  static isTerminal(snapshot: ChatRuntimeSnapshot): boolean {
    return isTerminalChatRunPhase(snapshot.phase);
  }
}

let repository: ChatRuntimeRepository | null = null;

export function getChatRuntimeRepository(): ChatRuntimeRepository {
  return repository ??= new ChatRuntimeRepository();
}
