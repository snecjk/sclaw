import type { SqliteMigration } from '../types';
import initialSqliteSchemaMigration from './0001-initial-schema';
import memoryCaptureJobsMigration from './0006-memory-capture-jobs';
import sessionCatalogSchemaMigration from './0007-session-catalog-schema';
import sessionTypesAndChannelsMigration from './0008-session-types-and-channels';
import channelPlaneMigration from './0011-channel-plane';
import workflowRuntimeSchemaMigration from './0012-workflow-runtime-schema';

// Keep migrations as explicit imports so Electron/Vite bundling can retain them
// reliably in both dev and packaged builds.
// When adding a new migration file, register it here explicitly.
export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  initialSqliteSchemaMigration,
  memoryCaptureJobsMigration,
  sessionCatalogSchemaMigration,
  sessionTypesAndChannelsMigration,
  channelPlaneMigration,
  workflowRuntimeSchemaMigration,
].sort((left, right) => left.version - right.version);
