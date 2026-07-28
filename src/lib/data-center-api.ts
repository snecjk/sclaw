import { hostApiFetch } from '@/lib/host-api';
import type {
  DataCenterApiResponse,
  DataCenterEntriesResult,
  DataCenterEntryShareStatus,
  DataCenterEntry,
  DataCenterEntryDetail,
  DataCenterQuota,
  DataCenterShareEntriesParams,
  DataCenterShareEntriesResult,
  DataCenterSortField,
  DataCenterSortOrder,
  DataCenterSpace,
  DataCenterSpaceType,
  DataCenterSpacesResult,
  DataCenterTempUrl,
  DataCenterUploadArtifactParams,
  DataCenterUploadDriveFileParams,
} from '@/types/data-center';
import { DataCenterApiError } from '@/types/data-center';

const DATA_CENTER_BASE = '/ai-memory/agent/v1/data-center';
export const DATA_CENTER_API_NOT_FOUND = 'DATA_CENTER_API_NOT_FOUND';

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

async function unwrapDataCenter<T>(promise: Promise<DataCenterApiResponse<T>>): Promise<T> {
  let response: DataCenterApiResponse<T>;
  try {
    response = await promise;
  } catch (error) {
    const maybeError = error as { message?: string; details?: { status?: number } };
    const status = maybeError.details?.status;
    if (status === 404 || maybeError.message === 'HTTP 404') {
      throw new DataCenterApiError(
        DATA_CENTER_API_NOT_FOUND,
        { status: 404, errCode: DATA_CENTER_API_NOT_FOUND },
      );
    }
    throw error;
  }
  if (!response.success || response.data === null) {
    throw new DataCenterApiError(
      response.errMessage || response.errCode || '数据中心请求失败',
      { errCode: response.errCode, traceId: response.traceId },
    );
  }
  return response.data;
}

export async function getDataCenterQuota(): Promise<DataCenterQuota> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterQuota>>(`${DATA_CENTER_BASE}/quota`));
}

export interface ListDataCenterEntriesParams {
  spaceType: DataCenterSpaceType;
  spaceId?: string;
  parentEntryId?: string;
  keyword?: string;
  entryType?: 'file' | 'folder';
  pageNo?: number;
  pageSize?: number;
  sortField?: DataCenterSortField;
  sortOrder?: DataCenterSortOrder;
}

export async function listDataCenterEntries(params: ListDataCenterEntriesParams): Promise<DataCenterEntriesResult> {
  const query = buildQuery({
    spaceType: params.spaceType,
    spaceId: params.spaceId,
    parentEntryId: params.parentEntryId ?? 'root',
    keyword: params.keyword?.trim(),
    entryType: params.entryType,
    pageNo: params.pageNo ?? 1,
    pageSize: params.pageSize ?? 50,
    sortField: params.sortField ?? 'updatedAt',
    sortOrder: params.sortOrder ?? 'desc',
  });
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterEntriesResult>>(`${DATA_CENTER_BASE}/entries${query}`));
}

export async function getDataCenterEntry(entryId: string): Promise<DataCenterEntryDetail> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterEntryDetail>>(
    `${DATA_CENTER_BASE}/entries/${encodeURIComponent(entryId)}`,
  ));
}

export async function createDataCenterFolder(params: {
  spaceType: DataCenterSpaceType;
  spaceId?: string;
  parentEntryId?: string;
  name: string;
}): Promise<DataCenterEntry> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterEntry>>(`${DATA_CENTER_BASE}/folder/create`, {
    method: 'POST',
    body: JSON.stringify({
      spaceType: params.spaceType,
      spaceId: params.spaceId,
      parentEntryId: params.parentEntryId ?? 'root',
      name: params.name,
    }),
  }));
}

export async function renameDataCenterEntry(entryId: string, name: string): Promise<DataCenterEntry> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterEntry>>(
    `${DATA_CENTER_BASE}/entries/${encodeURIComponent(entryId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  ));
}

export async function deleteDataCenterEntry(entryId: string): Promise<{ entryId: string; deleted: boolean }> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<{ entryId: string; deleted: boolean }>>(
    `${DATA_CENTER_BASE}/entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' },
  ));
}

export async function getDataCenterDownloadUrl(entryId: string): Promise<DataCenterTempUrl> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterTempUrl>>(
    `${DATA_CENTER_BASE}/entries/${encodeURIComponent(entryId)}/download-url`,
    { method: 'POST' },
  ));
}

export async function getDataCenterPreviewUrl(entryId: string): Promise<DataCenterTempUrl> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterTempUrl>>(
    `${DATA_CENTER_BASE}/entries/${encodeURIComponent(entryId)}/preview-url`,
    { method: 'POST' },
  ));
}

type DataCenterSpacesPayload =
  | DataCenterSpacesResult
  | DataCenterSpace[]
  | { items?: DataCenterSpace[]; records?: DataCenterSpace[] };

function normalizeDataCenterSpacesResult(payload: DataCenterSpacesPayload): DataCenterSpacesResult {
  if (Array.isArray(payload)) {
    return { spaces: payload };
  }
  if ('spaces' in payload && Array.isArray(payload.spaces)) {
    return { spaces: payload.spaces };
  }
  if ('items' in payload && Array.isArray(payload.items)) {
    return { spaces: payload.items };
  }
  if ('records' in payload && Array.isArray(payload.records)) {
    return { spaces: payload.records };
  }
  return { spaces: [] };
}

export async function getDataCenterSpaces(): Promise<DataCenterSpacesResult> {
  const payload = await unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterSpacesPayload>>(`${DATA_CENTER_BASE}/spaces`));
  return normalizeDataCenterSpacesResult(payload);
}

export async function shareDataCenterEntries(params: DataCenterShareEntriesParams): Promise<DataCenterShareEntriesResult> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterShareEntriesResult>>(`${DATA_CENTER_BASE}/entries/share`, {
    method: 'POST',
    body: JSON.stringify({
      sourceEntryIds: params.sourceEntryIds,
      targetSpaceId: params.targetSpaceId,
      targetParentEntryId: params.targetParentEntryId ?? 'root',
      idempotencyKey: params.idempotencyKey,
    }),
  }));
}

export async function deleteDataCenterSharedEntry(sharedEntryId: string): Promise<{ sharedEntryId: string; deleted: boolean }> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<{ sharedEntryId: string; deleted: boolean }>>(
    `${DATA_CENTER_BASE}/shared-entries/${encodeURIComponent(sharedEntryId)}`,
    { method: 'DELETE' },
  ));
}

export async function deleteDataCenterShare(shareId: string): Promise<{ shareId: string; deleted: boolean }> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<{ shareId: string; deleted: boolean }>>(
    `${DATA_CENTER_BASE}/shares/${encodeURIComponent(shareId)}`,
    { method: 'DELETE' },
  ));
}

export async function getDataCenterEntryShares(sourceEntryId: string): Promise<DataCenterEntryShareStatus> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterEntryShareStatus>>(
    `${DATA_CENTER_BASE}/entries/${encodeURIComponent(sourceEntryId)}/shares`,
  ));
}

export async function uploadDriveFileFromPath(params: DataCenterUploadDriveFileParams): Promise<DataCenterEntry> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterEntry>>('/api/data-center/files/upload', {
    method: 'POST',
    body: JSON.stringify(params),
  }));
}

export async function uploadArtifactFromPath(params: DataCenterUploadArtifactParams): Promise<DataCenterEntry> {
  return unwrapDataCenter(hostApiFetch<DataCenterApiResponse<DataCenterEntry>>('/api/data-center/artifacts/upload', {
    method: 'POST',
    body: JSON.stringify(params),
  }));
}

export function createDataCenterIdempotencyKey(prefix: string, stablePart?: string): string {
  const random = crypto.randomUUID();
  const cleanStable = stablePart?.trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 48);
  return [prefix, cleanStable, random].filter(Boolean).join('-').slice(0, 128);
}
