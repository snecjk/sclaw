import type { SqliteMigration } from '../types';

export const chatUserTurnCompositionsMigration: SqliteMigration = {
  version: 36,
  name: 'chat-user-turn-compositions',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_user_turn_compositions (
        session_key       TEXT NOT NULL,
        idempotency_key   TEXT NOT NULL,
        run_id            TEXT,
        engine_type       TEXT NOT NULL,
        status            TEXT NOT NULL,
        protocol_version  INTEGER NOT NULL,
        display_text      TEXT NOT NULL DEFAULT '',
        source_text       TEXT NOT NULL DEFAULT '',
        message_fingerprint TEXT NOT NULL DEFAULT '',
        provider_message_id TEXT,
        composition_json  TEXT NOT NULL,
        attachments_json  TEXT NOT NULL DEFAULT '[]',
        host_metadata_json TEXT NOT NULL DEFAULT '{}',
        error             TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (session_key, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_user_turn_compositions_history
        ON chat_user_turn_compositions(session_key, status, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_chat_user_turn_compositions_provider_message
        ON chat_user_turn_compositions(session_key, provider_message_id);
    `);
  },
};

export default chatUserTurnCompositionsMigration;
