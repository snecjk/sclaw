export type ArtifactSaveSourceType =
  | 'chat_artifact'
  | 'workflow_artifact'
  | 'scheduled_task_artifact';

export type ArtifactSaveStatus = 'pending' | 'uploading' | 'succeeded' | 'failed';

export interface DataCenterArtifactTarget {
  uri: string;
  spaceType: string;
  spaceId?: string | null;
  parentEntryId: string;
  label?: string | null;
}

export interface ArtifactSaveItem {
  artifactKey: string;
  name: string;
  filePath: string;
  contentType?: string | null;
  size?: number | null;
  mtimeMs?: number | null;
}

export interface ArtifactSaveRecord {
  id: string;
  sourceType: ArtifactSaveSourceType;
  sourceId: string;
  sourceTitle: string | null;
  runId: string | null;
  sessionId: string | null;
  artifactKey: string;
  artifactName: string;
  localPath: string | null;
  targetUri: string;
  targetLabel: string | null;
  status: ArtifactSaveStatus;
  dataCenterEntryId: string | null;
  dataCenterPathLabel: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

export interface CreateArtifactSaveRecordInput {
  id?: string;
  sourceType: ArtifactSaveSourceType;
  sourceId: string;
  sourceTitle?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  artifactKey: string;
  artifactName: string;
  localPath?: string | null;
  targetUri: string;
  targetLabel?: string | null;
  status?: ArtifactSaveStatus;
  dataCenterEntryId?: string | null;
  dataCenterPathLabel?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface UpdateArtifactSaveRecordInput {
  artifactName?: string;
  localPath?: string | null;
  targetLabel?: string | null;
  status?: ArtifactSaveStatus;
  dataCenterEntryId?: string | null;
  dataCenterPathLabel?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface ListArtifactSaveRecordsOptions {
  sourceType?: ArtifactSaveSourceType;
  sourceId?: string;
  runId?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface ArtifactSaveSummary {
  status: 'not_configured' | 'no_artifacts' | 'succeeded' | 'partial_failed' | 'failed';
  succeededCount: number;
  failedCount: number;
  records: ArtifactSaveRecord[];
}
