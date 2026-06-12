import type { WorkflowId } from '@/types/ids';

/** @api docs/api-contracts/workflows/page.md */
export type WorkflowLifecycleStatus = 'draft' | 'active' | 'archived';

/** @api docs/api-contracts/workflows/page.md */
export type WorkflowVersionStatus = 'draft' | 'published';

/** @api docs/api-contracts/workflows/page.md */
export interface WorkflowSummary {
  id: WorkflowId;
  name: string;
  version: number;
  lifecycleStatus: WorkflowLifecycleStatus;
  versionStatus: WorkflowVersionStatus;
  updatedAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
}

/** @api docs/api-contracts/workflows/page.md */
export interface WorkflowPageRequest {
  page?: number;
  pageSize?: number;
  createdBy?: string | null;
  keyword?: string | null;
}

/** @api docs/api-contracts/workflows/page.md */
export interface WorkflowPageResponse {
  success: boolean;
  data: WorkflowSummary[];
  total: number;
  page: number;
  pageSize: number;
  traceId: string;
}

export interface WorkflowListResult {
  items: WorkflowSummary[];
  total: number;
}
