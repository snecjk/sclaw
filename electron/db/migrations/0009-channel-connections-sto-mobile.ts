import type { SqliteMigration } from '../types';

/**
 * Align channel_connections.channel_type with platform design:
 * App 本地通道存 `sto-mobile`（非 wire/sessionKey 里的 `mobile`）。
 * 并补上设计稿中的 CHECK；历史误写 `mobile` 的行迁到 `sto-mobile`。
 *
 * Guard: only run when channel_connections table already exists (upgrade path).
 * Fresh installs get the final schema directly from v10, so skip entirely.
 */
export const channelConnectionsStoMobileMigration: SqliteMigration = {
  version: 9,
  name: 'channel-connections-sto-mobile',
  apply(db) {
    // Check if channel_connections table exists
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='channel_connections'",
    ).all() as Array<{ name: string }>;
    if (rows.length === 0) {
      // Fresh install — v10 will create the table with the correct schema.
      return;
    }

    // Check if sto_mobile_channel column already exists (idempotency)
    const cols = db.prepare('PRAGMA table_info(channel_connections)').all() as Array<{ name: string }>;
    const hasStoMobileCol = cols.some((c) => c.name === 'sto_mobile_channel');
    if (hasStoMobileCol) {
      return;
    }

    db.exec(`
      CREATE TABLE channel_connections_v9 (
        id                  TEXT PRIMARY KEY,
        channel_type        TEXT NOT NULL CHECK (
                              channel_type IN ('dingtalk', 'wechat', 'sto-mobile')
                            ),
        account_id          TEXT NOT NULL DEFAULT 'default',
        enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

        device_id           TEXT NOT NULL,
        sto_mobile_device_id TEXT,
        sto_mobile_channel   TEXT,

        created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    // Copy existing rows, remapping 'sto-hub' / 'sto_hub' -> 'sto-mobile'
    db.exec(`
      INSERT INTO channel_connections_v9 (
        id, channel_type, account_id, enabled,
        device_id, sto_mobile_device_id, sto_mobile_channel,
        created_at, updated_at
      )
      SELECT
        id,
        CASE
          WHEN channel_type IN ('sto-hub', 'sto_hub') THEN 'sto-mobile'
          ELSE channel_type
        END,
        account_id,
        enabled,
        device_id,
        NULL,
        NULL,
        created_at,
        updated_at
      FROM channel_connections
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
