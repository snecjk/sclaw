import type { SqliteMigration } from '../types';

const CHANNEL_PLANE_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'external_user_id', ddl: 'TEXT' },
  { name: 'provider_account_id', ddl: 'TEXT' },
  { name: 'sto_mobile_channel', ddl: 'TEXT' },
  { name: 'bind_status', ddl: "TEXT NOT NULL DEFAULT 'unbound'" },
  { name: 'bound_at', ddl: 'TEXT' },
  { name: 'last_online_at', ddl: 'TEXT' },
  { name: 'refresh_token', ddl: 'TEXT' },
  { name: 'credential_token', ddl: 'TEXT' },
  { name: 'endpoint_base_url', ddl: 'TEXT' },
  { name: 'engine_type', ddl: 'TEXT' },
  { name: 'agent_id', ddl: 'TEXT' },
  { name: 'extras_json', ddl: 'TEXT' },
];

/**
 * Ensure channel_connections exists with the channel-plane schema.
 * Fresh installs create the full table; upgrade paths only ADD missing columns
 * so a prior v9 rebuild cannot leave the app without external_user_id.
 */
export const channelPlaneMigration: SqliteMigration = {
  version: 10,
  name: 'channel-plane-channel-connections',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_connections (
        id                  TEXT PRIMARY KEY,
        channel_type        TEXT NOT NULL,
        account_id          TEXT NOT NULL DEFAULT 'default',
        enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

        device_id           TEXT NOT NULL,
        external_user_id    TEXT,
        provider_account_id TEXT,
        sto_mobile_channel  TEXT,

        bind_status         TEXT NOT NULL DEFAULT 'unbound'
                              CHECK (bind_status IN ('unbound', 'bound', 'revoked')),
        bound_at            TEXT,
        last_online_at      TEXT,

        refresh_token       TEXT,
        credential_token    TEXT,
        endpoint_base_url   TEXT,

        engine_type         TEXT,
        agent_id            TEXT,

        extras_json         TEXT CHECK (
                              extras_json IS NULL OR json_valid(extras_json)
                            ),

        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,

        UNIQUE (channel_type, account_id)
      );
    `);

    const cols = db.prepare('PRAGMA table_info(channel_connections)').all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    for (const column of CHANNEL_PLANE_COLUMNS) {
      if (colNames.has(column.name)) continue;
      db.exec(`ALTER TABLE channel_connections ADD COLUMN ${column.name} ${column.ddl};`);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channel_connections_external
        ON channel_connections (channel_type, external_user_id);
    `);
  },
};

export default channelPlaneMigration;
