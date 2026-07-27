import type { SqliteMigration } from '../types';
import initialSqliteSchemaMigration from './0001-initial-schema';
import workflowRuntimeSchemaMigration from './0002-workflow-runtime';
import wfRunSessionKeyMigration from './0003-wf-run-session-key';
import workflowRuntimeShanghaiTimeMigration from './0004-workflow-runtime-shanghai-time';
import workflowRuntimeCloudIdsMigration from './0005-workflow-runtime-cloud-ids';
import memoryCaptureJobsMigration from './0006-memory-capture-jobs';
import sessionCatalogSchemaMigration from './0007-session-catalog-schema';
import sessionTypesAndChannelsMigration from './0008-session-types-and-channels';
import wfRunWorkflowVersionMigration from './0009-wf-run-workflow-version';
import channelPlaneMigration from './0011-channel-plane';
import wfRunEngineMigration from './0010-wf-run-engine';
import workflowRuntimeSchemaRepairMigration from './0012-workflow-runtime-schema-repair';
import workflowNodeAgentSessionMigration from './0013-workflow-node-agent-session';
import workflowNodeRunSchemaConsolidationMigration from './0014-workflow-node-run-schema-consolidation';

// Keep migrations as explicit imports so Electron/Vite bundling can retain them
// reliably in both dev and packaged builds.
// When adding a new migration file, register it here explicitly.
export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  initialSqliteSchemaMigration,
  workflowRuntimeSchemaMigration,
  wfRunSessionKeyMigration,
  workflowRuntimeShanghaiTimeMigration,
  workflowRuntimeCloudIdsMigration,
  memoryCaptureJobsMigration,
  sessionCatalogSchemaMigration,
  sessionTypesAndChannelsMigration,
  wfRunWorkflowVersionMigration,
  wfRunEngineMigration,
  channelPlaneMigration,
  workflowRuntimeSchemaRepairMigration,
  workflowNodeAgentSessionMigration,
  workflowNodeRunSchemaConsolidationMigration,
].sort((left, right) => left.version - right.version);
