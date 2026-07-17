import type { ColumnType, Generated } from 'kysely';

type Ts = ColumnType<string, string | undefined, string | undefined>;
type TsNull = ColumnType<string | null, string | null | undefined, string | null | undefined>;
type Int = ColumnType<number, number | undefined, number | undefined>;

export interface WfRunTable {
  id: number;
  run_id: string;
  workflow_id: string;
  version_id: string;
  status: string;
  mode: string;
  source: string;
  waiting_node_id: TsNull;
  input_json: TsNull;
  output_json: TsNull;
  last_agent_output_json: TsNull;
  last_agent_raw_text: TsNull;
  definition_json: string;
  error: TsNull;
  started_at: Ts;
  completed_at: TsNull;
  updated_at: Ts;
  synced_at: TsNull;
  session_key: TsNull;
  created_at: TsNull;
  deleted_at: TsNull;
}

export interface WfNodeRunTable {
  id: number;
  run_id: number;
  node_id: string;
  node_type: TsNull;
  status: string;
  attempt_count: Int;
  input_json: TsNull;
  output_json: TsNull;
  prompt_text: TsNull;
  last_completion_issue: TsNull;
  started_at: TsNull;
  completed_at: TsNull;
  created_at: TsNull;
  updated_at: TsNull;
  deleted_at: TsNull;
}

export interface WfEventTable {
  id: number;
  run_id: number;
  sequence: number;
  type: string;
  node_id: TsNull;
  run_ref_id: TsNull;
  skill_id: TsNull;
  tool_id: TsNull;
  call_id: TsNull;
  approval_id: TsNull;
  output_uri: TsNull;
  file_path: TsNull;
  reason: TsNull;
  message: TsNull;
  created_at: Ts;
  updated_at: TsNull;
  deleted_at: TsNull;
}

export interface WfArtifactTable {
  id: number;
  artifact_id: string;
  run_id: number;
  node_id: string;
  kind: string;
  uri: TsNull;
  file_path: TsNull;
  resource_id: TsNull;
  content_type: TsNull;
  summary: TsNull;
  created_at: Ts;
  updated_at: TsNull;
  deleted_at: TsNull;
}

export interface WfApprovalTaskTable {
  id: number;
  task_id: string;
  run_id: number;
  node_id: string;
  status: string;
  assignee_role: TsNull;
  reason: TsNull;
  decision_note: TsNull;
  requested_at: Ts;
  decided_at: TsNull;
  created_at: TsNull;
  updated_at: TsNull;
  deleted_at: TsNull;
}

export interface WfUserInputTaskTable {
  id: number;
  task_id: string;
  run_id: number;
  node_id: string;
  status: string;
  assignee_role: TsNull;
  title: TsNull;
  instruction: TsNull;
  form_schema_json: string;
  submitted_data_json: TsNull;
  requested_at: Ts;
  submitted_at: TsNull;
  created_at: TsNull;
  updated_at: TsNull;
  deleted_at: TsNull;
}

export interface WfOutboxTable {
  id: Generated<number>;
  run_id: string;
  entity_type: string;
  entity_ref: string;
  payload: string;
  sync_kind: string;
  status: string;
  attempts: number;
  next_retry_at: TsNull;
  created_at: Ts;
  synced_at: TsNull;
}
