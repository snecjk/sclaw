import type { ColumnType } from 'kysely';

export type MemoryKind = 'conversation_memory' | 'execution_experience';
export type MemoryCaptureStatus = 'pending' | 'ready' | 'summarizing' | 'stored' | 'skipped' | 'retry_wait' | 'failed';

export interface MemoryCaptureJobTable {
  id: string;
  source_id: string;
  memory_kind: MemoryKind;
  status: MemoryCaptureStatus;
  payload_json: string;
  session_key: string | null;
  agent_id: string | null;
  engine_type: string | null;
  memory_id: string | null;
  skip_reason: string | null;
  error_message: string | null;
  retry_count: number;
  next_retry_at: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  created_at: string;
  updated_at: string;
  completed_at: ColumnType<string | null, string | null | undefined, string | null | undefined>;
}
