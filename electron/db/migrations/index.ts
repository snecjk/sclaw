import type { SqliteMigration } from '../types';
import initialSqliteSchemaMigration from './0001-initial-schema';
import memoryCaptureJobsMigration from './0006-memory-capture-jobs';
import sessionCatalogSchemaMigration from './0007-session-catalog-schema';
import sessionTypesAndChannelsMigration from './0008-session-types-and-channels';
import channelPlaneMigration from './0010-channel-plane';
import scheduleTasksMigration from './0011-schedule-tasks';
import artifactSaveRecordsMigration from './0012-artifact-save-records';
import workflowRuntimeSchemaMigration from './0013-workflow-runtime-schema';
import artifactSaveRecordsFallbackMigration from './0021-artifact-save-records-fallback';

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
  artifactSaveRecordsMigration,
  workflowRuntimeSchemaMigration,
  artifactSaveRecordsFallbackMigration,
].sort((left, right) => left.version - right.version);
