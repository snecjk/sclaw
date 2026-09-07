import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../drizzle/schema.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '../..');

export function resolveDatabasePath(): string {
  const fromEnv = process.env.DATABASE_URL?.replace(/^file:/, '').trim();
  if (fromEnv) return fromEnv;
  return join(appRoot, '.data', 'app.db');
}

export function openSqlite(): Database.Database {
  const dbPath = resolveDatabasePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  return sqlite;
}

export function openDb() {
  return drizzle(openSqlite(), { schema });
}

export type AppDb = ReturnType<typeof openDb>;
