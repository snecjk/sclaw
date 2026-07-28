export type DataCenterSpaceType = 'drive' | 'qa_artifact' | 'site_shared_artifact';
export type DataCenterEntryType = 'file' | 'folder';
export type DataCenterSourceType = 'local_upload' | 'chat_artifact' | 'workflow_artifact' | 'scheduled_task_artifact';
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
  spaceId?: string | null;
  entryType: DataCenterEntryType;
  parentEntryId: string;
  name: string;
  mimeType: string | null;
  fileExt: string | null;
  fileSize: number;
  sourceType: DataCenterSourceType;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  runId?: string | null;
  artifactKey?: string | null;
  workflowTemplateId?: string | null;
  workflowRunId?: string | null;
  replayed?: boolean;
  shared?: boolean;
  shareId?: string | null;
  sourceEntryId?: string | null;
  sharedByName?: string | null;
  sharedAt?: string | null;
  canManage?: boolean;
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

export interface DataCenterSpace {
  spaceId: string;
  spaceType: DataCenterSpaceType;
  displayName: string;
  scopeType?: string | null;
  scopeName?: string | null;
  capabilities?: {
    canView?: boolean;
    canShare?: boolean;
    canCreateFolder?: boolean;
    canRead?: boolean;
    canWrite?: boolean;
    canManage?: boolean;
  } | null;
}

export interface DataCenterSpacesResult {
  spaces: DataCenterSpace[];
}

export interface DataCenterTempUrl {
  entryId: string;
  fileName: string;
  mimeType: string | null;
  tempUrl: string;
  expiresAt: string;
}

export interface DataCenterArtifactProvenance {
  sourceType: 'chat_artifact' | 'workflow_artifact' | 'scheduled_task_artifact';
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
  targetSpaceId?: string;
  targetParentEntryId?: string;
  idempotencyKey: string;
}

export interface DataCenterUploadDriveFileParams {
  filePath: string;
  fileName?: string;
  parentEntryId?: string;
  idempotencyKey: string;
}

export interface DataCenterShareEntriesParams {
  sourceEntryIds: string[];
  targetSpaceId: string;
  targetParentEntryId?: string;
  idempotencyKey: string;
}

export interface DataCenterShareEntriesResult {
  shareId: string;
  targetSpaceId: string;
  sharedRoots: Array<{
    entryId: string;
    sourceEntryId: string;
    entryType: DataCenterEntryType;
    name: string;
  }>;
}

export interface DataCenterEntryShareStatus {
  shared: boolean;
  shares?: Array<{
    shareId: string;
    sharedEntryId?: string;
    targetSpaceId?: string;
    sharedByName?: string | null;
    sharedAt?: string | null;
    canManage?: boolean;
  }>;
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
