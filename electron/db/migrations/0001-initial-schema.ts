import type { SqliteMigration } from '../types';

export const initialSqliteSchemaMigration: SqliteMigration = {
  version: 1,
  name: 'initial-local-sqlite-demo-schema',
  sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_demo_records (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'inactive')
      ),
      payload_json TEXT CHECK (
        payload_json IS NULL OR json_valid(payload_json)
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by TEXT,
      updated_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_app_demo_records_status
      ON app_demo_records(status);

    CREATE INDEX IF NOT EXISTS idx_app_demo_records_updated_at
      ON app_demo_records(updated_at DESC);
  `,
};

export default initialSqliteSchemaMigration;
