import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runDatabaseMigrations } from '../../electron/db/migrator';

describe('SQLite legacy session catalog migration normalization', () => {
  let db: DatabaseSync | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('remaps legacy catalog v2/types v3 and still applies memory v2', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at) VALUES
        (2, 'session-catalog-schema', datetime('now')),
        (3, 'session-types-and-channels', datetime('now'));
    `);

    runDatabaseMigrations(db);

    const rows = db.prepare(
      'SELECT version, name FROM schema_migrations ORDER BY version ASC',
    ).all() as Array<{ version: number; name: string }>;
    expect(rows).toEqual([
      { version: 1, name: 'initial-local-sqlite-demo-schema' },
      { version: 2, name: 'memory-capture-jobs' },
      { version: 3, name: 'session-catalog-schema' },
      { version: 4, name: 'session-types-and-channels' },
      { version: 5, name: 'channel-plane-channel-connections' },
    ]);

    const memoryTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_capture_jobs'",
    ).get() as { name?: string } | undefined;
    expect(memoryTable?.name).toBe('memory_capture_jobs');
  });

  it('backfills canonical versions when the same migrations were recorded under higher numbers', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE catalog_sessions (
        workspace_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        session_type TEXT NOT NULL DEFAULT 'chat',
        task_id TEXT,
        app_id TEXT,
        channel_type TEXT,
        channel_id TEXT,
        PRIMARY KEY (workspace_id, session_key)
      );
      CREATE TABLE session_engine_bindings (
        session_key TEXT PRIMARY KEY,
        engine_type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        provider TEXT
      );
      INSERT INTO schema_migrations (version, name, applied_at) VALUES
        (1, 'initial-local-sqlite-demo-schema', datetime('now')),
        (6, 'memory-capture-jobs', datetime('now')),
        (7, 'session-catalog-schema', datetime('now')),
        (8, 'session-types-and-channels', datetime('now')),
        (10, 'channel-plane-channel-connections', datetime('now'));
    `);

    expect(() => runDatabaseMigrations(db!)).not.toThrow();

    const rows = db.prepare(
      'SELECT version, name FROM schema_migrations WHERE version BETWEEN 1 AND 5 ORDER BY version ASC',
    ).all() as Array<{ version: number; name: string }>;
    expect(rows).toEqual([
      { version: 1, name: 'initial-local-sqlite-demo-schema' },
      { version: 2, name: 'memory-capture-jobs' },
      { version: 3, name: 'session-catalog-schema' },
      { version: 4, name: 'session-types-and-channels' },
      { version: 5, name: 'channel-plane-channel-connections' },
    ]);
  });

});
