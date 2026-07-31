import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runDatabaseMigrations } from '../../electron/db/migrator';
import channelPlaneMigration from '../../electron/db/migrations/0010-channel-plane';
import workflowRuntimeSchemaMigration from '../../electron/db/migrations/0013-workflow-runtime-schema';

const FINAL_MIGRATION_ROWS = [
  { version: 1, name: 'initial-local-sqlite-demo-schema' },
  { version: 6, name: 'memory-capture-jobs' },
  { version: 7, name: 'session-catalog-schema' },
  { version: 8, name: 'session-types-and-channels' },
  { version: 10, name: 'channel-plane-channel-connections' },
  { version: 11, name: 'schedule-tasks' },
  { version: 12, name: 'artifact-save-records' },
  { version: 13, name: 'workflow-runtime-schema' },
] as const;

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
    expect(rows).toEqual([...FINAL_MIGRATION_ROWS]);

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
    expect(rows).toEqual([...FINAL_MIGRATION_ROWS]);
  });

  it('remaps legacy channel-plane v5 to v10 so workflow cloud-id migration can apply', () => {
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
        (4, 'session-types-and-channels', datetime('now')),
        (5, 'channel-plane-channel-connections', datetime('now'));
    `);

    runDatabaseMigrations(db);

    const rows = db.prepare(
      'SELECT version, name FROM schema_migrations ORDER BY version ASC',
    ).all() as Array<{ version: number; name: string }>;
    expect(rows).toEqual([...FINAL_MIGRATION_ROWS]);
  });

  it('frees the 0710 v11/v12 slots for scheduled tasks and artifact saves', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    db.exec(channelPlaneMigration.sql!);
    workflowRuntimeSchemaMigration.apply!(db);
    db.exec(`
      INSERT INTO schema_migrations (version, name, applied_at) VALUES
        (11, 'channel-plane-channel-connections', datetime('now')),
        (12, 'workflow-runtime-schema', datetime('now'));
    `);

    runDatabaseMigrations(db);

    const rows = db.prepare(
      'SELECT version, name FROM schema_migrations ORDER BY version ASC',
    ).all() as Array<{ version: number; name: string }>;
    expect(rows).toEqual([...FINAL_MIGRATION_ROWS]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schedule_tasks'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifact_save_records'").get()).toBeTruthy();
  });
});
