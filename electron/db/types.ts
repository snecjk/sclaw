import type { DatabaseSync } from 'node:sqlite';
import type { DemoRecordTable } from './models/tables/demo-record-table';
import type { ChannelConnectionTable } from './models/tables/channel-connection-table';

// One migration file corresponds to one schema version.
export interface SqliteMigration {
  version: number;
  name: string;
  sql: string;
}

export interface SqliteMigrationRecord {
  version: number;
  name: string;
  appliedAt: string;
}

export interface SqliteDatabaseInfo {
  filePath: string;
  journalMode: string;
  foreignKeysEnabled: boolean;
}

export interface SqliteRecordTimestamps {
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export type SqliteDatabase = DatabaseSync;

export interface SchemaMigrationsTable {
  version: number;
  name: string;
  applied_at: string;
}

// Kysely's root schema map: every table must be registered here once.
export interface SqliteDbSchema {
  schema_migrations: SchemaMigrationsTable;
  app_demo_records: DemoRecordTable;
  channel_connections: ChannelConnectionTable;
}
