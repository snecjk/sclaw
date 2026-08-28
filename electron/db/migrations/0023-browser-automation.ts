import type { SqliteMigration } from '../types';

export const browserAutomationMigration: SqliteMigration = {
  version: 23,
  name: 'browser-automation',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ba_session (
        session_id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('embed', 'managed')),
        embed_runtime_id TEXT,
        url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        web_contents_id INTEGER,
        automation_pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ba_run (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workflow_run_id TEXT,
        status TEXT NOT NULL,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        input_json TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (session_id) REFERENCES ba_session(session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ba_run_session ON ba_run(session_id);

      CREATE TABLE IF NOT EXISTS ba_step_run (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        target_json TEXT,
        payload_json TEXT,
        observation_json TEXT,
        validator_json TEXT,
        error TEXT,
        duration_ms INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(run_id, step_index),
        FOREIGN KEY (run_id) REFERENCES ba_run(run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ba_step_run_run ON ba_step_run(run_id, step_index);
    `);
  },
};

export default browserAutomationMigration;
