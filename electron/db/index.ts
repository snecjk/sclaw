export { getKyselyDatabase, getSqliteDatabase, getSqliteDatabaseInfo, getSqliteDatabasePath, initializeSqliteDatabase } from './connection';
export { createKyselySqliteClient, NodeSqliteDatabaseAdapter } from './kysely-sqlite';
export type {
  DemoRecordStatus,
  DemoRecord,
} from './models/domain/demo-record';
export type {
  CatalogSession,
  SessionEngineBinding,
  SessionGroup,
  Workspace,
} from './models/domain/session-catalog';
export { DEFAULT_WORKSPACE_ID } from './models/domain/session-catalog';
export type {
  CreateDemoRecordInput,
  ListDemoRecordsOptions,
  UpdateDemoRecordInput,
} from './models/dto/demo-record.dto';
export type {
  CreateWorkspaceInput,
  ListCatalogSessionsOptions,
  ListWorkspacesOptions,
  UpsertCatalogSessionInput,
} from './models/dto/session-catalog.dto';
export type {
  DemoRecordTable,
} from './models/tables/demo-record-table';
export type {
  CatalogSessionsTable,
  SessionEngineBindingsTable,
  SessionGroupsTable,
  WorkspacesTable,
} from './models/tables/session-catalog-tables';
export {
  DemoRecordRepository,
  getDemoRecordRepository,
} from './repositories/demo-record-repository';
export {
  CatalogSessionRepository,
  getCatalogSessionRepository,
} from './repositories/catalog-session-repository';
export {
  SessionEngineBindingRepository,
  getSessionEngineBindingRepository,
} from './repositories/session-engine-binding-repository';
export { bindingToRegistryEntry } from '../engines/session-binding-map';
export {
  SessionGroupRepository,
  getSessionGroupRepository,
} from './repositories/session-group-repository';
export {
  WorkspaceRepository,
  getWorkspaceRepository,
} from './repositories/workspace-repository';
export type { SqliteDatabaseInfo, SqliteMigration, SqliteMigrationRecord, SqliteRecordTimestamps } from './types';
