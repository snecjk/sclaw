import type { ColumnType, Generated } from 'kysely';
import type { DemoRecordStatus } from '../domain/demo-record';

export type TimestampColumn = ColumnType<string, string | undefined, string | undefined>;
export type NullableTimestampColumn = ColumnType<string | null, string | null | undefined, string | null | undefined>;

// Table models describe raw database columns exactly as they are stored.
export interface DemoRecordTable {
  id: string;
  name: string;
  description: string | null;
  status: DemoRecordStatus;
  payload_json: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: NullableTimestampColumn;
  version: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
}
