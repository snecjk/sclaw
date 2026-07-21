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

});
