import type { SqliteMigration } from '../types';

/**
 * Align channel_connections.channel_type with platform design:
 * App 本地通道存 `sto-mobile`（非 wire/sessionKey 里的 `mobile`）。
 * 并补上设计稿中的 CHECK；历史误写 `mobile` 的行迁到 `sto-mobile`。
 */
export const channelConnectionsStoMobileMigration: SqliteMigration = {
  version: 6,
  name: 'channel-connections-sto-mobile',
  sql: `
    CREATE TABLE channel_connections_v6 (
      id                  TEXT PRIMARY KEY,
      channel_type        TEXT NOT NULL CHECK (
                            channel_type IN ('dingtalk', 'wechat', 'sto-mobile')
                          ),
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

    INSERT INTO channel_connections_v6 (
      id, channel_type, account_id, enabled,
      device_id, external_user_id, provider_account_id,
      bind_status, bound_at, last_online_at,
      refresh_token, credential_token, endpoint_base_url,
      engine_type, agent_id, extras_json,
      created_at, updated_at
    )
    SELECT
      id,
      CASE
        WHEN channel_type = 'mobile' THEN 'sto-mobile'
        ELSE channel_type
      END,
      account_id, enabled,
      device_id, external_user_id, provider_account_id,
      bind_status, bound_at, last_online_at,
      refresh_token, credential_token, endpoint_base_url,
      engine_type, agent_id, extras_json,
      created_at, updated_at
    FROM channel_connections
    WHERE channel_type IN ('dingtalk', 'wechat', 'sto-mobile', 'mobile');

    DROP TABLE channel_connections;
    ALTER TABLE channel_connections_v6 RENAME TO channel_connections;

    CREATE INDEX IF NOT EXISTS idx_channel_connections_external
      ON channel_connections (channel_type, external_user_id);
  `,
};

export default channelConnectionsStoMobileMigration;
