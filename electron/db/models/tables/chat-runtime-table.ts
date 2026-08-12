import type { Generated } from 'kysely';

export interface ChatRuntimeRunsTable {
  id: string;
  session_key: string;
  run_id: string | null;
  idempotency_key: string;
  origin: 'interactive' | 'scheduled_task' | 'channel';
  owner_id: string | null;
  deadline_at: number | null;
  engine_type: 'openclaw' | 'claude';
  phase: string;
  epoch: number;
  sequence: number;
  started_at: number;
  last_event_at: number;
  terminal_at: number | null;
  error: string | null;
  acceptance_result_json: string | null;
  created_at: string;
  updated_at: string;
  version: Generated<number>;
}
