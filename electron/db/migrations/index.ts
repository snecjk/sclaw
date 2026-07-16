import type { SqliteMigration } from '../types';
import initialSqliteSchemaMigration from './0001-initial-schema';
import workflowRuntimeSchemaMigration from './0002-workflow-runtime';
import wfRunSessionKeyMigration from './0003-wf-run-session-key';
import workflowRuntimeShanghaiTimeMigration from './0004-workflow-runtime-shanghai-time';

// Keep migrations as explicit imports so Electron/Vite bundling can retain them
// reliably in both dev and packaged builds.
// When adding a new migration file, register it here explicitly.
export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  initialSqliteSchemaMigration,
  workflowRuntimeSchemaMigration,
  wfRunSessionKeyMigration,
  workflowRuntimeShanghaiTimeMigration,
].sort((left, right) => left.version - right.version);
