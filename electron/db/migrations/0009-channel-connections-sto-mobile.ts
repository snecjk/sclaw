import type { SqliteMigration } from '../types';

/**
 * Align channel_connections.channel_type with platform design:
 * App 本地通道存 `sto-mobile`（非 wire/sessionKey 里的 `mobile`）。
 * 并补上设计稿中的 CHECK；历史误写 `mobile` / `sto-hub` 的行迁到 `sto-mobile`。
 *
 * Guard: only run when channel_connections table already exists (upgrade path).
 * Fresh installs get the final schema directly from v10, so skip entirely.
 *
 * Important: legacy channel-plane may already be remapped to v10 in
 * schema_migrations, so this upgrade path MUST preserve the full plane columns
 * (including external_user_id) — v10 will not re-create the table.
 */
export const channelConnectionsStoMobileMigration: SqliteMigration = {
  version: 9,
  name: 'channel-connections-sto-mobile',
  apply(db) {
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='channel_connections'",
    ).all() as Array<{ name: string }>;
    if (rows.length === 0) {
      // Fresh install — v10 will create the table with the correct schema.
      return;
    }

    const cols = db.prepare('PRAGMA table_info(channel_connections)').all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    // Already upgraded (by this migration or a later plane schema that includes the column).
    if (colNames.has('sto_mobile_channel') && colNames.has('external_user_id')) {
      return;
    }

    const pick = (name: string): string => (colNames.has(name) ? name : 'NULL');

    db.exec(`
      CREATE TABLE channel_connections_v9 (
        id                  TEXT PRIMARY KEY,
        channel_type        TEXT NOT NULL CHECK (
                              channel_type IN ('dingtalk', 'wechat', 'sto-mobile')
                            ),
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

    db.exec(`
      INSERT INTO channel_connections_v9 (
        id, channel_type, account_id, enabled,
        device_id, external_user_id, provider_account_id, sto_mobile_channel,
        bind_status, bound_at, last_online_at,
        refresh_token, credential_token, endpoint_base_url,
        engine_type, agent_id, extras_json,
        created_at, updated_at
      )
      SELECT
        id,
        CASE
          WHEN channel_type IN ('mobile', 'sto-hub', 'sto_hub') THEN 'sto-mobile'
          ELSE channel_type
        END,
        COALESCE(account_id, 'default'),
        COALESCE(enabled, 1),
        device_id,
        ${pick('external_user_id')},
        ${pick('provider_account_id')},
        ${pick('sto_mobile_channel')},
        COALESCE(${pick('bind_status')}, 'unbound'),
        ${pick('bound_at')},
        ${pick('last_online_at')},
        ${pick('refresh_token')},
        ${pick('credential_token')},
        ${pick('endpoint_base_url')},
        ${pick('engine_type')},
        ${pick('agent_id')},
        ${pick('extras_json')},
        created_at,
        updated_at
      FROM channel_connections
      WHERE channel_type IN (
        'dingtalk', 'wechat', 'sto-mobile', 'mobile', 'sto-hub', 'sto_hub'
      );
    `);

    db.exec('DROP TABLE channel_connections;');
    db.exec('ALTER TABLE channel_connections_v9 RENAME TO channel_connections;');

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channel_connections_external
        ON channel_connections (channel_type, external_user_id);
    `);
  },
};

export default channelConnectionsStoMobileMigration;
