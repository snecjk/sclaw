import type { DatabaseSync } from 'node:sqlite';
import type { DemoRecordTable } from './models/tables/demo-record-table';
import type {
  WfApprovalTaskTable,
  WfArtifactTable,
  WfEventTable,
  WfNodeRunTable,
  WfOutboxTable,
  WfRunTable,
  WfUserInputTaskTable,
} from './models/tables/workflow-runtime-tables';
import type { MemoryCaptureJobTable } from './models/tables/memory-capture-job-table';
import type {
  CatalogSessionsTable,
  SessionEngineBindingsTable,
  SessionGroupsTable,
  WorkspacesTable,
} from './models/tables/session-catalog-tables';
import type { ChannelConnectionTable } from './models/tables/channel-connection-table';
import type { ScheduleTaskRunsTable, ScheduleTasksTable } from './models/tables/schedule-task-tables';
import type { ArtifactSaveRecordsTable } from './models/tables/artifact-save-record-table';
import type { ChatRuntimeRunsTable } from './models/tables/chat-runtime-table';
import type {
  BaRunTable,
  BaSessionTable,
  BaStepRunTable,
} from './models/tables/browser-automation-tables';

// One migration file corresponds to one schema version.
export interface SqliteMigration {
  version: number;
  name: string;
  sql?: string;
  apply?: (db: SqliteDatabase) => void;
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
  wf_run: WfRunTable;
  wf_node_run: WfNodeRunTable;
  wf_event: WfEventTable;
  wf_artifact: WfArtifactTable;
  wf_approval_task: WfApprovalTaskTable;
  wf_user_input_task: WfUserInputTaskTable;
  wf_outbox: WfOutboxTable;
  memory_capture_jobs: MemoryCaptureJobTable;
  workspaces: WorkspacesTable;
  session_groups: SessionGroupsTable;
  catalog_sessions: CatalogSessionsTable;
  session_engine_bindings: SessionEngineBindingsTable;
  channel_connections: ChannelConnectionTable;
  schedule_tasks: ScheduleTasksTable;
  schedule_task_runs: ScheduleTaskRunsTable;
  artifact_save_records: ArtifactSaveRecordsTable;
  chat_runtime_runs: ChatRuntimeRunsTable;
  ba_session: BaSessionTable;
  ba_run: BaRunTable;
  ba_step_run: BaStepRunTable;
}
