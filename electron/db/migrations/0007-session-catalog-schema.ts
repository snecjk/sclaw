import type { SqliteMigration } from '../types';

const DEFAULT_WORKSPACE_ID = 'default';

export const sessionCatalogSchemaMigration: SqliteMigration = {
  version: 7,
  name: 'session-catalog-schema',
  sql: `
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by TEXT,
      updated_by TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_default
      ON workspaces(is_default)
      WHERE is_default = 1 AND deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS session_groups (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE INDEX IF NOT EXISTS idx_session_groups_workspace
      ON session_groups(workspace_id, sort_order ASC)
      WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS catalog_sessions (
      workspace_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      group_id TEXT,
      title TEXT,
      pin_rank INTEGER,
      sort_key TEXT,
      last_activity_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by TEXT,
      updated_by TEXT,
      PRIMARY KEY (workspace_id, session_key),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (group_id) REFERENCES session_groups(id)
    );

    CREATE INDEX IF NOT EXISTS idx_catalog_sessions_workspace_activity
      ON catalog_sessions(workspace_id, last_activity_at DESC)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_catalog_sessions_workspace_pin
      ON catalog_sessions(workspace_id, pin_rank ASC, last_activity_at DESC)
      WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS session_engine_bindings (
      session_key TEXT PRIMARY KEY,
      engine_type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      engine_session_id TEXT,
      cwd TEXT,
      model TEXT,
      account_id TEXT,
      extra_json TEXT CHECK (extra_json IS NULL OR json_valid(extra_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by TEXT,
      updated_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_session_engine_bindings_agent
      ON session_engine_bindings(agent_id, updated_at DESC)
      WHERE deleted_at IS NULL;

    INSERT OR IGNORE INTO workspaces (
      id, name, root_path, is_default, created_at, updated_at, version
    ) VALUES (
      '${DEFAULT_WORKSPACE_ID}',
      'Default',
      '',
      1,
      datetime('now'),
      datetime('now'),
      1
    );
  `,
};

export default sessionCatalogSchemaMigration;
