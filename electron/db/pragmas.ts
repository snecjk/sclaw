import type { SqliteDatabase } from './types';

function readPragmaValue(db: SqliteDatabase, pragmaSql: string): string {
  const row = db.prepare(pragmaSql).get() as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : '';
  return String(value ?? '');
}

export function applyDatabasePragmas(db: SqliteDatabase): void {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA temp_store = MEMORY;');
}

export function getDatabaseJournalMode(db: SqliteDatabase): string {
  return readPragmaValue(db, 'PRAGMA journal_mode;');
}

export function getForeignKeysEnabled(db: SqliteDatabase): boolean {
  return readPragmaValue(db, 'PRAGMA foreign_keys;') === '1';
}
