import type { DemoRecordStatus } from '../domain/demo-record';

// DTOs define repository/service inputs instead of raw table rows.
export interface CreateDemoRecordInput {
  id?: string;
  name: string;
  description?: string | null;
  status?: DemoRecordStatus;
  payload?: Record<string, unknown> | null;
  actor?: string | null;
}

export interface UpdateDemoRecordInput {
  name?: string;
  description?: string | null;
  status?: DemoRecordStatus;
  payload?: Record<string, unknown> | null;
  actor?: string | null;
}

export interface ListDemoRecordsOptions {
  includeDeleted?: boolean;
  status?: DemoRecordStatus;
  limit?: number;
  offset?: number;
}
