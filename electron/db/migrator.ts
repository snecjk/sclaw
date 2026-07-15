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
