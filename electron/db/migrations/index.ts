import type { SqliteMigration } from '../types';
import initialSqliteSchemaMigration from './0001-initial-schema';
import memoryCaptureJobsMigration from './0006-memory-capture-jobs';
import sessionCatalogSchemaMigration from './0007-session-catalog-schema';
import sessionTypesAndChannelsMigration from './0008-session-types-and-channels';
import channelConnectionsStoMobileMigration from './0009-channel-connections-sto-mobile';
import channelPlaneMigration from './0010-channel-plane';
import scheduleTasksMigration from './0011-schedule-tasks';
import artifactSaveRecordsMigration from './0012-artifact-save-records';
import workflowRuntimeSchemaMigration from './0013-workflow-runtime-schema';
import artifactSaveRecordsFallbackMigration from './0021-artifact-save-records-fallback';
import chatRuntimeMigration from './0022-chat-runtime';
import scheduleTasksCloudSyncMigration from './0033-schedule-tasks-cloud-sync';
import browserAutomationMigration from './0023-browser-automation';
import chatRuntimeBridgeOriginMigration from './0024-chat-runtime-bridge-origin';
import chatRuntimePiEngineMigration from './0034-chat-runtime-pi-engine';
import sessionSkillStatesMigration from './0035-session-skill-states';
import chatUserTurnCompositionsMigration from './0036-chat-user-turn-compositions';
import chatRuntimeActivityMigration from './0037-chat-runtime-activity';
import chatContextUsageMigration from './0038-chat-context-usage';
import browserAutomationArtifactsMigration from './0039-browser-automation-artifacts';
import chatRuntimeInterruptCauseMigration from './0040-chat-runtime-interrupt-cause';

// Keep migrations as explicit imports so Electron/Vite bundling can retain them
// reliably in both dev and packaged builds.
// When adding a new migration file, register it here explicitly.
export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  initialSqliteSchemaMigration,
  memoryCaptureJobsMigration,
  sessionCatalogSchemaMigration,
  sessionTypesAndChannelsMigration,
  channelConnectionsStoMobileMigration,
  channelPlaneMigration,
  scheduleTasksMigration,
  artifactSaveRecordsMigration,
  workflowRuntimeSchemaMigration,
  artifactSaveRecordsFallbackMigration,
  chatRuntimeMigration,
  scheduleTasksCloudSyncMigration,
  browserAutomationMigration,
  chatRuntimeBridgeOriginMigration,
  chatRuntimePiEngineMigration,
  sessionSkillStatesMigration,
  chatUserTurnCompositionsMigration,
  chatRuntimeActivityMigration,
  chatContextUsageMigration,
  browserAutomationArtifactsMigration,
  chatRuntimeInterruptCauseMigration,
].sort((left, right) => left.version - right.version);
