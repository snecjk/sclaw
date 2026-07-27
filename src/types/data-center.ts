export type DataCenterSpaceType = 'drive' | 'qa_artifact';
export type DataCenterEntryType = 'file' | 'folder';
export type DataCenterTraceStatus = 'none' | 'pending' | 'verified' | 'missing';
export type DataCenterSourceType = 'local_upload' | 'chat_artifact' | 'workflow_artifact';
export type DataCenterViewMode = 'list' | 'grid';
export type DataCenterSortField = 'name' | 'updatedAt' | 'fileSize' | 'createdAt';
export type DataCenterSortOrder = 'asc' | 'desc';

export interface DataCenterApiResponse<T> {
  success: boolean;
  data: T | null;
  traceId?: string;
  errCode?: string;
  errMessage?: string;
}

export interface DataCenterBreadcrumb {
  entryId: string;
  name: string;
}

export interface DataCenterEntry {
  entryId: string;
  spaceType: DataCenterSpaceType;
  entryType: DataCenterEntryType;
  parentEntryId: string;
  name: string;
  mimeType: string | null;
  fileExt: string | null;
  fileSize: number;
  sourceType: DataCenterSourceType;
  traceStatus: DataCenterTraceStatus | null;
  traceAvailable: boolean;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  replayed?: boolean;
}

export interface DataCenterEntryDetail extends DataCenterEntry {
  breadcrumbs?: DataCenterBreadcrumb[];
}

export interface DataCenterQuota {
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

export interface DataCenterEntriesResult {
  items: DataCenterEntry[];
  total: number;
  pageNo: number;
  pageSize: number;
  breadcrumbs: DataCenterBreadcrumb[];
}

export interface DataCenterTempUrl {
  entryId: string;
  fileName: string;
  mimeType: string | null;
  tempUrl: string;
  expiresAt: string;
}

export interface DataCenterTrace {
  traceAvailable: boolean;
  traceStatus: DataCenterTraceStatus;
  sessionId: string | null;
  messageId: string | null;
  runId: string | null;
  workflowTemplateId: string | null;
  workflowRunId: string | null;
}

export interface DataCenterArtifactProvenance {
  sourceType: 'chat_artifact' | 'workflow_artifact';
  sessionId: string;
  artifactKey: string;
  messageId?: string;
  runId?: string;
  workflowTemplateId?: string;
  workflowRunId?: string;
}

export interface DataCenterUploadArtifactParams extends DataCenterArtifactProvenance {
  filePath: string;
  fileName?: string;
  parentEntryId?: string;
  idempotencyKey: string;
}

export interface DataCenterUploadDriveFileParams {
  filePath: string;
  fileName?: string;
  parentEntryId?: string;
  idempotencyKey: string;
}

export class DataCenterApiError extends Error {
  status?: number;
  errCode?: string;
  traceId?: string;

  constructor(message: string, options: { status?: number; errCode?: string; traceId?: string } = {}) {
    super(message);
    this.name = 'DataCenterApiError';
    this.status = options.status;
    this.errCode = options.errCode;
    this.traceId = options.traceId;
  }
}
