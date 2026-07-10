import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Kysely, SqliteDialect, type SqliteDatabase, type SqliteStatement } from 'kysely';
import type { SqliteDbSchema } from './types';

function isReaderQuery(sql: string): boolean {
  const normalized = sql.trim().toLowerCase();
  return normalized.startsWith('select')
    || normalized.startsWith('with')
    || normalized.startsWith('pragma')
    || normalized.startsWith('explain');
}

// Kysely's built-in SqliteDialect expects a better-sqlite3-like API.
// This wrapper adapts Node's built-in `node:sqlite` to that minimal contract.
class NodeSqliteStatementWrapper implements SqliteStatement {
  readonly reader: boolean;
  readonly #statement: StatementSync;

  constructor(statement: StatementSync, sql: string) {
    this.#statement = statement;
    this.reader = isReaderQuery(sql);
  }

  #normalizeParameters(parameters: ReadonlyArray<unknown>): any[] {
    return [...parameters] as any[];
  }

  all(parameters: ReadonlyArray<unknown>): unknown[] {
    return this.#statement.all(...this.#normalizeParameters(parameters));
  }

  run(parameters: ReadonlyArray<unknown>): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  } {
    const result = this.#statement.run(...this.#normalizeParameters(parameters));
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown> {
    return this.#statement.iterate(...this.#normalizeParameters(parameters)) as IterableIterator<unknown>;
  }
}

export class NodeSqliteDatabaseAdapter implements SqliteDatabase {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  close(): void {
    this.#db.close();
  }

  prepare(sql: string): SqliteStatement {
    return new NodeSqliteStatementWrapper(this.#db.prepare(sql), sql);
  }
}

export function createKyselySqliteClient(db: DatabaseSync): Kysely<SqliteDbSchema> {
  const sqliteDatabase = new NodeSqliteDatabaseAdapter(db);

  return new Kysely<SqliteDbSchema>({
    // Reuse Kysely's standard SQLite dialect once the adapter surface matches.
    dialect: new SqliteDialect({
      database: sqliteDatabase,
    }),
  });
}
