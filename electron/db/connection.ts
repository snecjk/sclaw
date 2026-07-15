import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import { getDataDir } from '../utils/paths';
import { createKyselySqliteClient } from './kysely-sqlite';
import { applyDatabasePragmas, getDatabaseJournalMode, getForeignKeysEnabled } from './pragmas';
import { runDatabaseMigrations } from './migrator';
import type { SqliteDatabase, SqliteDatabaseInfo, SqliteDbSchema } from './types';

const SQLITE_DIR_NAME = 'sqlite';
const SQLITE_DB_FILE_NAME = 'stoclaw.sqlite';

let databaseInstance: SqliteDatabase | null = null;
let kyselyInstance: Kysely<SqliteDbSchema> | null = null;
let databaseInfo: SqliteDatabaseInfo | null = null;

export function getSqliteDatabasePath(): string {
  return join(getDataDir(), SQLITE_DIR_NAME, SQLITE_DB_FILE_NAME);
}

export function initializeSqliteDatabase(): SqliteDatabase {
  if (databaseInstance) {
    return databaseInstance;
  }

  const filePath = getSqliteDatabasePath();
  mkdirSync(dirname(filePath), { recursive: true });

  // Initialize the raw SQLite connection first, then layer Kysely on top of it.
  const db = new DatabaseSync(filePath);
  applyDatabasePragmas(db);
  runDatabaseMigrations(db);

  databaseInstance = db;
  kyselyInstance = createKyselySqliteClient(db);
  databaseInfo = {
    filePath,
    journalMode: getDatabaseJournalMode(db),
    foreignKeysEnabled: getForeignKeysEnabled(db),
  };
  return db;
}

export function getSqliteDatabase(): SqliteDatabase {
  return initializeSqliteDatabase();
}

// Main-process callers should prefer this typed Kysely client for queries.
export function getKyselyDatabase(): Kysely<SqliteDbSchema> {
  if (!kyselyInstance) {
    initializeSqliteDatabase();
  }
  return kyselyInstance as Kysely<SqliteDbSchema>;
}

export function getSqliteDatabaseInfo(): SqliteDatabaseInfo {
  if (!databaseInfo) {
    initializeSqliteDatabase();
  }
  return databaseInfo as SqliteDatabaseInfo;
}
