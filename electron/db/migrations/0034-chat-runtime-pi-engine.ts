import type { SqliteMigration } from '../types';

function tableColumnNames(
  db: Parameters<NonNullable<SqliteMigration['apply']>>[0],
  table: string,
): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => String(row.name)));
}

function chatRuntimeAllowsPi(
  db: Parameters<NonNullable<SqliteMigration['apply']>>[0],
): boolean {
  const row = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_runtime_runs'`,
  ).get() as { sql?: string } | undefined;
  return typeof row?.sql === 'string'
    && /engine_type IN \('openclaw','claude','pi'\)/.test(row.sql);
}

/** Expand the immutable engine snapshot constraint without rewriting existing runs. */
export const chatRuntimePiEngineMigration: SqliteMigration = {
  version: 34,
  name: 'chat-runtime-pi-engine',
  apply(db) {
    const names = tableColumnNames(db, 'chat_runtime_runs');
    if (names.size === 0 || chatRuntimeAllowsPi(db)) return;

    const extraDefs = [
      names.has('interrupt_cause') ? 'interrupt_cause TEXT' : null,
      names.has('activity_json') ? 'activity_json TEXT' : null,
      names.has('context_usage_json') ? 'context_usage_json TEXT' : null,
    ].filter((value): value is string => Boolean(value));
    const extraSql = extraDefs.length > 0 ? `,\n        ${extraDefs.join(',\n        ')}` : '';
    const insertCols = [
      'id',
      'session_key',
      'run_id',
      'idempotency_key',
      'origin',
      'owner_id',
      'deadline_at',
      'engine_type',
      'phase',
      'epoch',
      'sequence',
      'started_at',
      'last_event_at',
      'terminal_at',
      'error',
      'interrupt_cause',
      'acceptance_result_json',
      'activity_json',
      'context_usage_json',
      'created_at',
      'updated_at',
      'version',
    ].filter((column) => names.has(column));
    const insertList = insertCols.join(', ');

    db.exec(`
      CREATE TABLE chat_runtime_runs_next (
        id                     TEXT PRIMARY KEY,
        session_key            TEXT NOT NULL,
        run_id                 TEXT,
        idempotency_key        TEXT NOT NULL,
        origin                 TEXT NOT NULL DEFAULT 'interactive'
                               CHECK (origin IN ('interactive','scheduled_task','channel','bridge')),
        owner_id               TEXT,
        deadline_at            INTEGER,
        engine_type            TEXT NOT NULL CHECK (engine_type IN ('openclaw','claude','pi')),
        phase                  TEXT NOT NULL,
        epoch                  INTEGER NOT NULL DEFAULT 1 CHECK (epoch > 0),
        sequence               INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
        started_at             INTEGER NOT NULL,
        last_event_at          INTEGER NOT NULL,
        terminal_at            INTEGER,
        error                  TEXT,
        acceptance_result_json TEXT,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL,
        version                INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
        ${extraSql}
      );

      INSERT INTO chat_runtime_runs_next (${insertList})
      SELECT ${insertList} FROM chat_runtime_runs;

      DROP TABLE chat_runtime_runs;
      ALTER TABLE chat_runtime_runs_next RENAME TO chat_runtime_runs;

      CREATE UNIQUE INDEX idx_chat_runtime_idempotency
        ON chat_runtime_runs(session_key, idempotency_key);
      CREATE INDEX idx_chat_runtime_active
        ON chat_runtime_runs(phase, updated_at DESC);
      CREATE INDEX idx_chat_runtime_session
        ON chat_runtime_runs(session_key, updated_at DESC);
      CREATE INDEX idx_chat_runtime_run
        ON chat_runtime_runs(session_key, run_id)
        WHERE run_id IS NOT NULL;
      CREATE INDEX idx_chat_runtime_owner
        ON chat_runtime_runs(origin, owner_id)
        WHERE owner_id IS NOT NULL;
    `);
  },
};

export default chatRuntimePiEngineMigration;
