// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runDatabaseMigrations } from '../../electron/db/migrator';

describe('SQLite channel_connections sto-mobile migration (v9)', () => {
  let db: DatabaseSync | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('preserves external_user_id when upgrading a legacy channel_connections table', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      -- Legacy channel-plane already recorded as v10, so v10 will be skipped.
      INSERT INTO schema_migrations (version, name, applied_at) VALUES
        (1, 'initial-local-sqlite-demo-schema', datetime('now')),
        (6, 'memory-capture-jobs', datetime('now')),
        (7, 'session-catalog-schema', datetime('now')),
        (8, 'session-types-and-channels', datetime('now')),
        (10, 'channel-plane-channel-connections', datetime('now'));

      CREATE TABLE channel_connections (
        id TEXT PRIMARY KEY,
        channel_type TEXT NOT NULL,
        account_id TEXT NOT NULL DEFAULT 'default',
        enabled INTEGER NOT NULL DEFAULT 1,
        device_id TEXT NOT NULL,
        external_user_id TEXT,
        provider_account_id TEXT,
        bind_status TEXT NOT NULL DEFAULT 'unbound',
        bound_at TEXT,
        last_online_at TEXT,
        refresh_token TEXT,
        credential_token TEXT,
        endpoint_base_url TEXT,
        engine_type TEXT,
        agent_id TEXT,
        extras_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (channel_type, account_id)
      );

      INSERT INTO channel_connections (
        id, channel_type, account_id, enabled, device_id,
        external_user_id, provider_account_id, bind_status,
        created_at, updated_at
      ) VALUES (
        'conn-1', 'sto-hub', 'default', 1, 'device-1',
        'user-42', NULL, 'bound',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);

    expect(() => runDatabaseMigrations(db!)).not.toThrow();

    const cols = db.prepare('PRAGMA table_info(channel_connections)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('external_user_id');
    expect(colNames).toContain('sto_mobile_channel');

    const row = db.prepare(
      'SELECT channel_type, external_user_id FROM channel_connections WHERE id = ?',
    ).get('conn-1') as { channel_type: string; external_user_id: string };

    expect(row.channel_type).toBe('sto-mobile');
    expect(row.external_user_id).toBe('user-42');
  });

  it('fresh install skips v9 rebuild and still creates external_user_id via v10', () => {
    db = new DatabaseSync(':memory:');
    runDatabaseMigrations(db);

    const cols = db.prepare('PRAGMA table_info(channel_connections)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('external_user_id');
  });
});
