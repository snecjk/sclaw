export type DemoRecordStatus = 'active' | 'inactive';

// Domain models are the objects business code reads after repository mapping.
export interface DemoRecord {
  id: string;
  name: string;
  description: string | null;
  status: DemoRecordStatus;
  payload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}
