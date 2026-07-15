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
 * The session-catalog feature branch originally shipped catalog/types as v2/v3,
 * while the memory branch already owned v2. Normalize that pre-merge layout so
 * each migration keeps a unique version and existing developer databases remain
 * bootable after the branches are combined.
 */
export function normalizeLegacySessionCatalogMigrationVersions(db: SqliteDatabase): void {
  const rows = db.prepare(
    'SELECT version, name FROM schema_migrations WHERE version IN (2, 3, 4) ORDER BY version ASC',
  ).all() as Array<{ version: number; name: string }>;
  const byVersion = new Map(rows.map((row) => [Number(row.version), String(row.name)]));
  if (byVersion.get(2) !== 'session-catalog-schema') return;

  const version3Name = byVersion.get(3);
  const version4Name = byVersion.get(4);
  if (version3Name && version3Name !== 'session-types-and-channels') {
    throw new Error(`[sqlite] cannot remap legacy session catalog: v3 is ${version3Name}`);
  }
  if (version4Name && version4Name !== 'session-types-and-channels') {
    throw new Error(`[sqlite] cannot remap legacy session catalog: v4 is ${version4Name}`);
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    if (version3Name === 'session-types-and-channels') {
      if (version4Name === 'session-types-and-channels') {
        db.prepare('DELETE FROM schema_migrations WHERE version = 3').run();
      } else {
        db.prepare('UPDATE schema_migrations SET version = 4 WHERE version = 3').run();
      }
    }
    db.prepare('UPDATE schema_migrations SET version = 3 WHERE version = 2').run();
    db.exec('COMMIT;');
    logger.info('[sqlite] normalized legacy session catalog migrations v2/v3 -> v3/v4');
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
      db.exec(migration.sql);
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
