import type { ColumnType, Generated } from 'kysely';
import type { AgentEngineType } from '../../../engines/types';

export type TimestampColumn = ColumnType<string, string | undefined, string | undefined>;
export type NullableTimestampColumn = ColumnType<string | null, string | null | undefined, string | null | undefined>;

export interface WorkspacesTable {
  id: string;
  name: string;
  root_path: string;
  is_default: number;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: NullableTimestampColumn;
  version: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
}

export interface SessionGroupsTable {
  id: string;
  workspace_id: string;
  name: string;
  sort_order: number;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: NullableTimestampColumn;
  version: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
}

export interface CatalogSessionsTable {
  workspace_id: string;
  session_key: string;
  group_id: string | null;
  title: string | null;
  pin_rank: number | null;
  sort_key: string | null;
  last_activity_at: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: NullableTimestampColumn;
  version: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
}

export interface SessionEngineBindingsTable {
  session_key: string;
  engine_type: AgentEngineType;
  agent_id: string;
  engine_session_id: string | null;
  cwd: string | null;
  model: string | null;
  account_id: string | null;
  extra_json: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: NullableTimestampColumn;
  version: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
}
