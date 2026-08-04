import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import { applyDatabasePragmas } from '../../electron/db/pragmas';
import { runDatabaseMigrations } from '../../electron/db/migrator';
import { createKyselySqliteClient } from '../../electron/db/kysely-sqlite';
import { setKyselyDatabaseForTests } from '../../electron/db/connection';
import type { SqliteDbSchema } from '../../electron/db/types';

// vitest runs in node, but mirror connection.ts's createRequire trick so the
// helper is resilient to any Vite/vite-node `node:sqlite` resolution quirk.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export interface InMemoryDb {
  db: DatabaseSync;
  kysely: Kysely<SqliteDbSchema>;
  teardown: () => void;
}

/**
 * Stand up a throwaway in-memory SQLite DB, apply the real migration suite
 * (so FKs + the seeded `default` workspace exist), wrap it in the same Kysely
 * adapter prod uses, and inject it via the connection test seam so every repo's
 * `getKyselyDatabase()` call hits this DB. Call `teardown()` per test.
 */
export function setupInMemoryDb(): InMemoryDb {
  const db = new DatabaseSync(':memory:');
  applyDatabasePragmas(db);
  runDatabaseMigrations(db);
  const kysely = createKyselySqliteClient(db);
  setKyselyDatabaseForTests(kysely);
  return {
    db,
    kysely,
    teardown: () => {
      setKyselyDatabaseForTests(null);
      db.close();
    },
  };
}
