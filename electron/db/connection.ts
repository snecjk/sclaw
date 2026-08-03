import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { Kysely } from 'kysely';
import { getDataDir } from '../utils/paths';
import { createKyselySqliteClient } from './kysely-sqlite';
import { applyDatabasePragmas, getDatabaseJournalMode, getForeignKeysEnabled } from './pragmas';
import { runDatabaseMigrations } from './migrator';
import type { SqliteDatabase, SqliteDatabaseInfo, SqliteDbSchema } from './types';

// Vite 会把静态 `import from 'node:sqlite'` 错误解析成 browser external，导致主进程包构建失败、
// session-catalog IPC handler 无法注册。主进程改用 createRequire 在运行时加载 Node 内置模块。
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

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

/**
 * Test-only seam: inject a Kysely client (typically wrapping an in-memory
 * `DatabaseSync`) so the repositories' `getKyselyDatabase()` calls run against
 * a throwaway DB in node tests — `initializeSqliteDatabase()` cannot run there
 * because it resolves the DB path via `app.getPath('userData')` (Electron-only).
 * Pass `null` to tear down (restores the uninitialized singleton state).
 *
 * Mirrors the `*ForTests` convention used elsewhere (e.g. resetDwsSendDedupForTests).
 */
export function setKyselyDatabaseForTests(kysely: Kysely<SqliteDbSchema> | null): void {
  kyselyInstance = kysely;
  databaseInstance = null;
  databaseInfo = null;
}
