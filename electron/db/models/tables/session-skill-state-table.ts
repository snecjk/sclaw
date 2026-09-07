import type { ColumnType } from 'kysely';

export interface SessionSkillStatesTable {
  session_key: string;
  turn_no: number;
  manifest_revision: string;
  last_remote_route_turn: number | null;
  last_task_fingerprint: string | null;
  last_query: string | null;
  state_json: string;
  created_at: ColumnType<string, string | undefined, never>;
  updated_at: ColumnType<string, string | undefined, string>;
}
