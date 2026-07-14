import type { ColumnType, Generated } from 'kysely';

type Ts = ColumnType<string, string | undefined, string | undefined>;
type TsNull = ColumnType<string | null, string | null | undefined, string | null | undefined>;
type Int = ColumnType<number, number | undefined, number | undefined>;

export interface WfRunTable {
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
}

export interface WfNodeRunTable {
  run_id: string;
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
}

export interface WfEventTable {
  run_id: string;
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
}

export interface WfArtifactTable {
  artifact_id: string;
  run_id: string;
  node_id: TsNull;
  kind: string;
  uri: TsNull;
  file_path: TsNull;
  resource_id: TsNull;
  content_type: TsNull;
  summary: TsNull;
  created_at: Ts;
}

export interface WfApprovalTaskTable {
  task_id: string;
  run_id: string;
  node_id: TsNull;
  status: string;
  assignee_role: TsNull;
  reason: TsNull;
  decision_note: TsNull;
  requested_at: Ts;
  decided_at: TsNull;
}

export interface WfUserInputTaskTable {
  task_id: string;
  run_id: string;
  node_id: TsNull;
  status: string;
  assignee_role: TsNull;
  title: TsNull;
  instruction: TsNull;
  form_schema_json: TsNull;
  submitted_data_json: TsNull;
  requested_at: Ts;
  submitted_at: TsNull;
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
