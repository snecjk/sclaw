import type { SqliteMigration } from '../types';

export const sessionTypesAndChannelsMigration: SqliteMigration = {
  version: 8,
  name: 'session-types-and-channels',
  sql: `
    -- Session classification and channel association
    ALTER TABLE catalog_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'chat';
    ALTER TABLE catalog_sessions ADD COLUMN task_id TEXT;
    ALTER TABLE catalog_sessions ADD COLUMN app_id TEXT;
    ALTER TABLE catalog_sessions ADD COLUMN channel_type TEXT;
    ALTER TABLE catalog_sessions ADD COLUMN channel_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_catalog_sessions_session_type
      ON catalog_sessions(workspace_id, session_type)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_catalog_sessions_task_id
      ON catalog_sessions(task_id)
      WHERE deleted_at IS NULL AND task_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_catalog_sessions_app_id
      ON catalog_sessions(app_id)
      WHERE deleted_at IS NULL AND app_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_catalog_sessions_channel
      ON catalog_sessions(channel_type, channel_id)
      WHERE deleted_at IS NULL AND channel_type IS NOT NULL;

    -- Model provider for engine bindings
    ALTER TABLE session_engine_bindings ADD COLUMN provider TEXT;

    CREATE INDEX IF NOT EXISTS idx_session_engine_bindings_provider
      ON session_engine_bindings(provider)
      WHERE deleted_at IS NULL AND provider IS NOT NULL;
  `,
};

export default sessionTypesAndChannelsMigration;
