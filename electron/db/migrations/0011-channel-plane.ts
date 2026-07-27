import type { SqliteMigration } from '../types';

export const channelPlaneMigration: SqliteMigration = {
  version: 11,
  name: 'channel-plane-channel-connections',
  sql: `
    CREATE TABLE IF NOT EXISTS channel_connections (
      id                  TEXT PRIMARY KEY,
      channel_type        TEXT NOT NULL,
      account_id          TEXT NOT NULL DEFAULT 'default',
      enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

      device_id           TEXT NOT NULL,
      external_user_id    TEXT,
      provider_account_id TEXT,

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

    CREATE INDEX IF NOT EXISTS idx_channel_connections_external
      ON channel_connections (channel_type, external_user_id);
  `,
};

export default channelPlaneMigration;
