import type { Generated } from 'kysely';
import type { NullableTimestampColumn, TimestampColumn } from './session-catalog-tables';

export interface ArtifactSaveRecordsTable {
  id: string;
  source_type: string;
  source_id: string;
  source_title: string | null;
  run_id: string | null;
  session_id: string | null;
  artifact_key: string;
  artifact_name: string;
  local_path: string | null;
  target_uri: string;
  target_label: string | null;
  status: string;
  data_center_entry_id: string | null;
  data_center_path_label: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: NullableTimestampColumn;
  version: Generated<number>;
}
