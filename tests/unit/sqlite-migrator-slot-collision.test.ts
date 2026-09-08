import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SQLITE_MIGRATIONS } from '../../electron/db/migrations';
import { runDatabaseMigrations } from '../../electron/db/migrator';

const CHAT_RUNTIME_WITH_SIDE_BRANCH_COLUMNS = `
  CREATE TABLE chat_runtime_runs (
    id                     TEXT PRIMARY KEY,
    session_key            TEXT NOT NULL,
    run_id                 TEXT,
    idempotency_key        TEXT NOT NULL,
    origin                 TEXT NOT NULL DEFAULT 'interactive'
                           CHECK (origin IN ('interactive','scheduled_task','channel','bridge')),
    owner_id               TEXT,
    deadline_at            INTEGER,
    engine_type            TEXT NOT NULL CHECK (engine_type IN ('openclaw','claude')),
    phase                  TEXT NOT NULL,
    epoch                  INTEGER NOT NULL DEFAULT 1 CHECK (epoch > 0),
    sequence               INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
    started_at             INTEGER NOT NULL,
    last_event_at          INTEGER NOT NULL,
    terminal_at            INTEGER,
    error                  TEXT,
    acceptance_result_json TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    version                INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    interrupt_cause        TEXT,
    activity_json          TEXT,
    context_usage_json     TEXT
  );
`;

function recordMigrations(
  db: DatabaseSync,
  versions: Array<{ version: number; name: string }>,
): void {
  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime(\'now\'))',
  );
  for (const row of versions) insert.run(row.version, row.name);
}

function migrationName(version: number): string {
  const migration = SQLITE_MIGRATIONS.find((item) => item.version === version);
  if (!migration) throw new Error(`missing migration v${version}`);
  return migration.name;
}

function recordCanonicalThrough(db: DatabaseSync, lastVersion: number): void {
  recordMigrations(
    db,
    SQLITE_MIGRATIONS
      .filter((migration) => migration.version <= lastVersion)
      .map((migration) => ({ version: migration.version, name: migration.name })),
  );
}

describe('SQLite side-branch v34/v35 slot collision', () => {
  let db: DatabaseSync | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('frees v34/v35 so session_skill_states can apply after a colliding local history', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      ${CHAT_RUNTIME_WITH_SIDE_BRANCH_COLUMNS}
    `);
    recordCanonicalThrough(db, 33);
    recordMigrations(db, [
      { version: 34, name: 'browser-automation-artifacts' },
      { version: 35, name: 'chat-runtime-interrupt-cause' },
      { version: 36, name: migrationName(36) },
      { version: 37, name: migrationName(37) },
      { version: 38, name: migrationName(38) },
      { version: 39, name: 'browser-automation-artifacts' },
      { version: 40, name: 'chat-runtime-interrupt-cause' },
    ]);

    expect(() => runDatabaseMigrations(db!)).not.toThrow();

    const rows = db.prepare(
      'SELECT version, name FROM schema_migrations WHERE version BETWEEN 34 AND 40 ORDER BY version',
    ).all() as Array<{ version: number; name: string }>;
    expect(rows).toEqual([
      { version: 34, name: 'chat-runtime-pi-engine' },
      { version: 35, name: 'session-skill-states' },
      { version: 36, name: migrationName(36) },
      { version: 37, name: migrationName(37) },
      { version: 38, name: migrationName(38) },
      { version: 39, name: 'browser-automation-artifacts' },
      { version: 40, name: 'chat-runtime-interrupt-cause' },
    ]);

    const skillTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_skill_states'",
    ).get() as { name?: string } | undefined;
    expect(skillTable?.name).toBe('session_skill_states');

    const cols = db.prepare('PRAGMA table_info(chat_runtime_runs)').all() as Array<{ name: string }>;
    expect(cols.map((col) => col.name)).toEqual(expect.arrayContaining([
      'interrupt_cause',
      'activity_json',
      'context_usage_json',
    ]));

    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_runtime_runs'",
    ).get() as { sql: string };
    expect(tableSql.sql).toContain("'pi'");
  });

  it('remaps colliding v34/v35 before the canonical main migrations have been recorded', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      ${CHAT_RUNTIME_WITH_SIDE_BRANCH_COLUMNS}
    `);
    recordCanonicalThrough(db, 33);
    recordMigrations(db, [
      { version: 34, name: 'browser-automation-artifacts' },
      { version: 35, name: 'chat-runtime-interrupt-cause' },
    ]);

    expect(() => runDatabaseMigrations(db!)).not.toThrow();

    const skillTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_skill_states'",
    ).get() as { name?: string } | undefined;
    expect(skillTable?.name).toBe('session_skill_states');

    const v34 = db.prepare(
      'SELECT name FROM schema_migrations WHERE version = 34',
    ).get() as { name: string };
    const v35 = db.prepare(
      'SELECT name FROM schema_migrations WHERE version = 35',
    ).get() as { name: string };
    expect(v34.name).toBe('chat-runtime-pi-engine');
    expect(v35.name).toBe('session-skill-states');
  });
});
