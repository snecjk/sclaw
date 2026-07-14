import type { SqliteMigration } from '../types';
import initialSqliteSchemaMigration from './0001-initial-schema';
import channelPlaneMigration from './0002-channel-plane';

// Keep migrations as explicit imports so Electron/Vite bundling can retain them
// reliably in both dev and packaged builds.
// When adding a new migration file, register it here explicitly.
export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  initialSqliteSchemaMigration,
  channelPlaneMigration,
].sort((left, right) => left.version - right.version);
