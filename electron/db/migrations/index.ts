import type { SqliteMigration } from '../types';
import initialSqliteSchemaMigration from './0001-initial-schema';
import memoryCaptureJobsMigration from './0002-memory-capture-jobs';
import sessionCatalogSchemaMigration from './0003-session-catalog-schema';
import sessionTypesAndChannelsMigration from './0004-session-types-and-channels';
import channelPlaneMigration from './0005-channel-plane';
import scheduleTasksMigration from './0011-schedule-tasks';

// Keep migrations as explicit imports so Electron/Vite bundling can retain them
// reliably in both dev and packaged builds.
// When adding a new migration file, register it here explicitly.
export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  initialSqliteSchemaMigration,
  memoryCaptureJobsMigration,
  sessionCatalogSchemaMigration,
  sessionTypesAndChannelsMigration,
  channelPlaneMigration,
  scheduleTasksMigration,
].sort((left, right) => left.version - right.version);
