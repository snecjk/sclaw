import type { SqliteMigration } from '../types';

export default {
  version: 6,
  name: 'memory-capture-jobs',
  sql: `
    CREATE TABLE IF NOT EXISTS memory_capture_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      memory_kind TEXT NOT NULL CHECK (memory_kind IN ('conversation_memory', 'execution_experience')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'summarizing', 'stored', 'skipped', 'retry_wait', 'failed')),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      session_key TEXT,
      agent_id TEXT,
      engine_type TEXT,
      memory_id TEXT,
      skip_reason TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
      next_retry_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(memory_kind, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_capture_jobs_status_retry ON memory_capture_jobs(status, next_retry_at);
  `,
} satisfies SqliteMigration;
