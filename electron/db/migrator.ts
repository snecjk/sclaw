import { logger } from '../utils/logger';
import { SQLITE_MIGRATIONS } from './migrations';
import type { SqliteDatabase } from './types';

function ensureMigrationTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/**
 * The merged workflow branch owns v2-v5. Older memory/session builds used
 * those numbers independently, so remap their recorded versions before running
 * the append-only merged sequence (v6-v8). This retains all existing tables
 * while allowing the missing workflow migrations to execute exactly once.
 */
export function normalizeLegacySessionCatalogMigrationVersions(db: SqliteDatabase): void {
  const rows = db.prepare(
    'SELECT version, name FROM schema_migrations WHERE version IN (2, 3, 4, 6, 7, 8) ORDER BY version ASC',
  ).all() as Array<{ version: number; name: string }>;
  const byVersion = new Map(rows.map((row) => [Number(row.version), String(row.name)]));
  const version2Name = byVersion.get(2);
  if (version2Name !== 'session-catalog-schema' && version2Name !== 'memory-capture-jobs') return;

  const expected = version2Name === 'session-catalog-schema'
    ? new Map([[3, 'session-types-and-channels']])
    : new Map([[3, 'session-catalog-schema'], [4, 'session-types-and-channels']]);
  for (const [version, name] of expected) {
    const actual = byVersion.get(version);
    if (actual && actual !== name) {
      throw new Error(`[sqlite] cannot remap legacy memory/session migrations: v${version} is ${actual}`);
    }
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    if (version2Name === 'memory-capture-jobs') {
      if (byVersion.get(4) === 'session-types-and-channels') {
        db.prepare('UPDATE schema_migrations SET version = 8 WHERE version = 4').run();
      }
      if (byVersion.get(3) === 'session-catalog-schema') {
        db.prepare('UPDATE schema_migrations SET version = 7 WHERE version = 3').run();
      }
      db.prepare('UPDATE schema_migrations SET version = 6 WHERE version = 2').run();
    } else {
      if (byVersion.get(3) === 'session-types-and-channels') {
        db.prepare('UPDATE schema_migrations SET version = 8 WHERE version = 3').run();
      }
      db.prepare('UPDATE schema_migrations SET version = 7 WHERE version = 2').run();
    }
    db.exec('COMMIT;');
    logger.info('[sqlite] normalized legacy memory/session migration versions');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function getAppliedMigrationVersions(db: SqliteDatabase): Set<number> {
  const rows = db.prepare(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC',
  ).all() as Array<Record<string, unknown>>;

  return new Set(
    rows.map((row) => Number(row.version)).filter((version) => Number.isFinite(version)),
  );
}

export function runDatabaseMigrations(db: SqliteDatabase): void {
  ensureMigrationTable(db);
  normalizeLegacySessionCatalogMigrationVersions(db);
  const appliedVersions = getAppliedMigrationVersions(db);

  for (const migration of SQLITE_MIGRATIONS) {
    // Migrations are append-only: once a version is recorded, it is never rerun.
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    logger.info(`[sqlite] applying migration v${migration.version} ${migration.name}`);
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (migration.apply) {
        migration.apply(db);
      } else if (migration.sql) {
        db.exec(migration.sql);
      } else {
        throw new Error(`[sqlite] migration v${migration.version} has no operation`);
      }
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
}
