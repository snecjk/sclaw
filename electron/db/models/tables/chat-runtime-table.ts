import type { Generated } from 'kysely';

export interface ChatRuntimeRunsTable {
  id: string;
  session_key: string;
  run_id: string | null;
  idempotency_key: string;
  origin: 'interactive' | 'scheduled_task' | 'channel' | 'bridge';
  owner_id: string | null;
  deadline_at: number | null;
  engine_type: 'openclaw' | 'claude' | 'pi';
  phase: string;
  epoch: number;
  sequence: number;
  started_at: number;
  last_event_at: number;
  terminal_at: number | null;
  error: string | null;
  interrupt_cause: string | null;
  acceptance_result_json: string | null;
  activity_json: string | null;
  context_usage_json: string | null;
  created_at: string;
  updated_at: string;
  version: Generated<number>;
}
