import { basename, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { ArtifactSaveRecordRepository } from '../../db/repositories/artifact-save-record-repository';
import { getStoToken } from '../../utils/auth-store';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { buildStoMemoryCenterAuthHeaders } from '../../utils/sto-memory-api-auth';
import { logger } from '../../utils/logger';
import type {
  ArtifactSaveItem,
  ArtifactSaveRecord,
  ArtifactSaveSummary,
  ArtifactSaveSourceType,
  DataCenterArtifactTarget,
} from './types';
import { parseDataCenterTargetUri, targetLabel } from './target-uri';

const MAX_DATA_CENTER_FILE_BYTES = 200 * 1024 * 1024;

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
};

export interface SyncArtifactsToDataCenterInput {
  sourceType: ArtifactSaveSourceType;
  sourceId: string;
  sourceTitle?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  artifacts: ArtifactSaveItem[];
  targets: DataCenterArtifactTarget[];
  idempotencyScope: string;
}

function inferMimeType(fileName: string): string {
  return EXT_MIME_MAP[extname(fileName).toLowerCase()] || 'application/octet-stream';
}

function appendOptional(form: FormData, key: string, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) form.append(key, trimmed);
}

async function uploadArtifact(params: {
  sourceType: ArtifactSaveSourceType;
  sourceId: string;
  sourceTitle?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  artifact: ArtifactSaveItem;
  target: DataCenterArtifactTarget;
  idempotencyKey: string;
}): Promise<{ entryId?: string | null; pathLabel?: string | null }> {
  const filePath = params.artifact.filePath;
  const info = await stat(filePath);
  if (!info.isFile()) throw Object.assign(new Error('Selected path is not a file'), { statusCode: 400 });
  if (info.size <= 0) throw Object.assign(new Error('文件不能为空'), { statusCode: 413, errCode: 'FILE_EMPTY' });
  if (info.size > MAX_DATA_CENTER_FILE_BYTES) {
    throw Object.assign(new Error('文件不能超过 200 MiB'), { statusCode: 413, errCode: 'FILE_TOO_LARGE' });
  }

  const token = await getStoToken();
  if (!token) throw Object.assign(new Error('未登录或 stoToken 已过期，请重新登录'), { statusCode: 401, errCode: 'UNAUTHORIZED' });

  const fileName = params.artifact.name || basename(filePath) || 'file';
  const buffer = await readFile(filePath);
  const blob = new Blob([buffer], { type: params.artifact.contentType || inferMimeType(fileName) });
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('parentEntryId', params.target.spaceType === 'qa_artifact'
    ? params.target.parentEntryId || 'root'
    : 'root');
  form.append('idempotencyKey', params.idempotencyKey);
  form.append('sourceType', params.sourceType);
  form.append('sessionId', params.sessionId?.trim() || params.runId?.trim() || params.sourceId);
  form.append('artifactKey', params.artifact.artifactKey);
  form.append('sourceId', params.sourceId);
  appendOptional(form, 'sourceTitle', params.sourceTitle ?? undefined);
  appendOptional(form, 'runId', params.runId ?? undefined);
  if (params.target.spaceType !== 'qa_artifact') {
    appendOptional(form, 'targetSpaceType', params.target.spaceType);
    appendOptional(form, 'targetSpaceId', params.target.spaceId ?? undefined);
    form.append('targetParentEntryId', params.target.parentEntryId || 'root');
  }

  const baseUrl = await resolveStoBaseUrl();
  const response = await fetch(`${baseUrl}/agent/v1/data-center/artifacts/upload`, {
    method: 'POST',
    headers: buildStoMemoryCenterAuthHeaders(token),
    body: form,
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { success: false, errMessage: text || `HTTP ${response.status}` };
  }
  if (!response.ok || payload?.success === false) {
    const errMessage = payload?.errMessage || payload?.error || `HTTP ${response.status}`;
    throw Object.assign(new Error(errMessage), {
      statusCode: response.status,
      errCode: payload?.errCode,
    });
  }
  const data = payload?.data ?? payload;
  return {
    entryId: data?.entryId ?? data?.id ?? null,
    pathLabel: data?.pathLabel ?? data?.fullPath ?? null,
  };
}

export function resolveDataCenterTargetsFromUris(uris: Array<{ uri?: string | null; label?: string | null }>): DataCenterArtifactTarget[] {
  const targets: DataCenterArtifactTarget[] = [];
  const seen = new Set<string>();
  for (const item of uris) {
    if (!item.uri) continue;
    const target = parseDataCenterTargetUri(item.uri, item.label ?? null);
    if (!target || seen.has(target.uri)) continue;
    seen.add(target.uri);
    targets.push(target);
  }
  return targets;
}

export async function syncArtifactsToDataCenter(input: SyncArtifactsToDataCenterInput): Promise<ArtifactSaveSummary> {
  if (input.targets.length === 0) {
    return { status: 'not_configured', succeededCount: 0, failedCount: 0, records: [] };
  }
  if (input.artifacts.length === 0) {
    return { status: 'no_artifacts', succeededCount: 0, failedCount: 0, records: [] };
  }

  const repo = new ArtifactSaveRecordRepository();
  const records: ArtifactSaveRecord[] = [];
  for (const artifact of input.artifacts) {
    for (const target of input.targets) {
      const label = targetLabel(target);
      const idempotencyKey = [
        input.idempotencyScope,
        artifact.artifactKey,
        target.uri,
      ].join(':').replace(/\s+/g, '-').slice(0, 128);
      let record = await repo.createOrUpdate({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceTitle: input.sourceTitle ?? null,
        runId: input.runId ?? null,
        sessionId: input.sessionId ?? null,
        artifactKey: artifact.artifactKey,
        artifactName: artifact.name,
        localPath: artifact.filePath,
        targetUri: target.uri,
        targetLabel: label,
        status: 'uploading',
      });
      try {
        const result = await uploadArtifact({
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceTitle: input.sourceTitle,
          sessionId: input.sessionId,
          runId: input.runId,
          artifact,
          target,
          idempotencyKey,
        });
        record = await repo.update(record.id, {
          status: 'succeeded',
          dataCenterEntryId: result.entryId ?? null,
          dataCenterPathLabel: result.pathLabel ?? label,
          errorCode: null,
          errorMessage: null,
        });
      } catch (error) {
        const err = error as { errCode?: string; message?: string };
        record = await repo.update(record.id, {
          status: 'failed',
          errorCode: err.errCode ?? null,
          errorMessage: err.message ?? String(error),
        });
        logger.warn('[data-center-artifact-sync] upload failed', {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          runId: input.runId,
          artifactKey: artifact.artifactKey,
          targetUri: target.uri,
          error: err.message ?? String(error),
        });
      }
      records.push(record);
    }
  }

  const succeededCount = records.filter((record) => record.status === 'succeeded').length;
  const failedCount = records.filter((record) => record.status === 'failed').length;
  const status = failedCount === 0
    ? 'succeeded'
    : succeededCount > 0
      ? 'partial_failed'
      : 'failed';
  return { status, succeededCount, failedCount, records };
}
