import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runDatabaseMigrations } from '../../electron/db/migrator';

describe('SQLite legacy session catalog migration normalization', () => {
  let db: DatabaseSync | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('remaps legacy catalog v2/types v3 and applies the complete merged migration sequence', () => {
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
      { version: 2, name: 'workflow-runtime-7-tables' },
      { version: 3, name: 'wf-run-session-key' },
      { version: 4, name: 'workflow-runtime-shanghai-time' },
      { version: 5, name: 'workflow-runtime-cloud-primary-keys' },
      { version: 6, name: 'memory-capture-jobs' },
      { version: 7, name: 'session-catalog-schema' },
      { version: 8, name: 'session-types-and-channels' },
      { version: 9, name: 'wf-run-workflow-version' },
      { version: 10, name: 'wf-run-engine' },
      { version: 11, name: 'channel-plane-channel-connections' },
      { version: 12, name: 'workflow-runtime-canonical-schema-repair' },

    ]);

    const memoryTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_capture_jobs'",
    ).get() as { name?: string } | undefined;
    expect(memoryTable?.name).toBe('memory_capture_jobs');
  });

  it('remaps the legacy memory v2/catalog v3/types v4 sequence without dropping its records', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at) VALUES
        (2, 'memory-capture-jobs', datetime('now')),
        (3, 'session-catalog-schema', datetime('now')),
        (4, 'session-types-and-channels', datetime('now'));
    `);

    runDatabaseMigrations(db);

    const rows = db.prepare(
      'SELECT version, name FROM schema_migrations ORDER BY version ASC',
    ).all() as Array<{ version: number; name: string }>;
    expect(rows.map((row) => row.name)).toEqual([
      'initial-local-sqlite-demo-schema',
      'workflow-runtime-7-tables',
      'wf-run-session-key',
      'workflow-runtime-shanghai-time',
      'workflow-runtime-cloud-primary-keys',
      'memory-capture-jobs',
      'session-catalog-schema',
      'session-types-and-channels',
      'wf-run-workflow-version',
      'wf-run-engine',
      'channel-plane-channel-connections',
      'workflow-runtime-canonical-schema-repair',
    ]);
  });
});
