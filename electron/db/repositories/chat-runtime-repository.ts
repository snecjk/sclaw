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

  async upsert(snapshot: ChatRuntimeSnapshot): Promise<void> {
    const db = getKyselyDatabase();
    const idempotencyKey = snapshot.idempotencyKey ?? `runtime-${snapshot.sessionKey}-${snapshot.startedAt}`;
    const existing = await this.getByIdempotencyKey(snapshot.sessionKey, idempotencyKey);
    const timestamp = new Date(snapshot.updatedAt).toISOString();
    const values = {
      id: existing ? undefined : randomUUID(),
      session_key: snapshot.sessionKey,
      run_id: snapshot.runId,
      idempotency_key: idempotencyKey,
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

    if (existing) {
      await db.updateTable('chat_runtime_runs').set({
        run_id: values.run_id,
        phase: values.phase,
        epoch: values.epoch,
        sequence: values.sequence,
        last_event_at: values.last_event_at,
        terminal_at: values.terminal_at,
        error: values.error,
        acceptance_result_json: values.acceptance_result_json,
        updated_at: timestamp,
        version: sql<number>`version + 1`,
      }).where('session_key', '=', snapshot.sessionKey)
        .where('idempotency_key', '=', idempotencyKey)
        .execute();
      return;
    }

    await db.insertInto('chat_runtime_runs').values({
      ...values,
      id: values.id as string,
    }).execute();
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
