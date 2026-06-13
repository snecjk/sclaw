export type WorkflowId = string & { readonly __brand: 'WorkflowId' };

export function asWorkflowId(value: string): WorkflowId {
  return value as WorkflowId;
}

/** @api docs/api-contracts/workflows/page.md */
export type WorkflowLifecycleStatus = 'draft' | 'active' | 'archived';

/** @api docs/api-contracts/workflows/page.md */
export type WorkflowVersionStatus = 'draft' | 'published';

/** @api docs/api-contracts/workflows/template-mine.md */
export type WorkflowTemplateScope = 'system' | 'personal';

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

/** @api docs/api-contracts/workflows/template-mine.md */
export interface WorkflowTemplateMineItem {
  id: string;
  label: string;
  description: string | null;
  category: string | null;
  scope: WorkflowTemplateScope;
  ownerUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  nodeCount: number;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
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

/** @api docs/api-contracts/workflows/template-mine.md */
export interface WorkflowTemplateMineResponse {
  success: boolean;
  data: WorkflowTemplateMineItem[];
  total: number;
  page: number;
  pageSize: number;
  traceId: string;
}

export interface WorkflowListResult {
  items: WorkflowSummary[];
  total: number;
}
