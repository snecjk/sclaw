export interface BaSessionTable {
  session_id: string;
  source: 'embed' | 'managed';
  embed_runtime_id: string | null;
  url: string;
  title: string;
  web_contents_id: number | null;
  automation_pinned: number;
  created_at: string;
  updated_at: string;
  last_active_at: string;
}

export interface BaRunTable {
  run_id: string;
  session_id: string;
  workflow_run_id: string | null;
  status: string;
  current_step_index: number;
  input_json: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface BaStepRunTable {
  id: string;
  run_id: string;
  step_index: number;
  action: string;
  status: string;
  target_json: string | null;
  payload_json: string | null;
  observation_json: string | null;
  validator_json: string | null;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

/** BAP 产物登记（二进制不入库，仅元数据）。 */
export interface BaArtifactTable {
  artifact_id: string;
  session_id: string;
  run_id: string | null;
  kind: string;
  path: string;
  sha256: string;
  bytes: number;
  mime_type: string;
  created_at: string;
}
