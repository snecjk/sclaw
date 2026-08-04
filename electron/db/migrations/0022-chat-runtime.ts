import type { SqliteMigration } from '../types';

export const chatRuntimeMigration: SqliteMigration = {
  version: 22,
  name: 'chat-runtime',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_runtime_runs (
        id                     TEXT PRIMARY KEY,
        session_key            TEXT NOT NULL,
        run_id                 TEXT,
        idempotency_key        TEXT NOT NULL,
        origin                 TEXT NOT NULL DEFAULT 'interactive'
                               CHECK (origin IN ('interactive','scheduled_task','channel')),
        owner_id               TEXT,
        deadline_at            INTEGER,
        engine_type            TEXT NOT NULL CHECK (engine_type IN ('openclaw','claude')),
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
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_runtime_idempotency
        ON chat_runtime_runs(session_key, idempotency_key);

      CREATE INDEX IF NOT EXISTS idx_chat_runtime_active
        ON chat_runtime_runs(phase, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_chat_runtime_session
        ON chat_runtime_runs(session_key, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_chat_runtime_run
        ON chat_runtime_runs(session_key, run_id)
        WHERE run_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_chat_runtime_owner
        ON chat_runtime_runs(origin, owner_id)
        WHERE owner_id IS NOT NULL;
    `);
  },
};

export default chatRuntimeMigration;
