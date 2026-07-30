import { createHash } from 'node:crypto';
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
const DATA_CENTER_PAGE_SIZE = 200;
const MAX_UNIQUE_NAME_ATTEMPTS = 50;
const inFlightArtifactSaves = new Map<string, Promise<ArtifactSaveRecord>>();

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

interface DataCenterEntryListPayload {
  items?: Array<{ name?: unknown }>;
  records?: Array<{ name?: unknown }>;
  total?: number;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function inferMimeType(fileName: string): string {
  return EXT_MIME_MAP[extname(fileName).toLowerCase()] || 'application/octet-stream';
}

function normalizeNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function buildNumberedFileName(fileName: string, index: number): string {
  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  return `${stem} ${index}${ext}`;
}

function reserveUniqueFileName(requestedName: string, usedNames: Set<string>): string {
  const baseName = requestedName.trim() || 'file';
  let candidate = baseName;
  let index = 2;
  while (usedNames.has(normalizeNameKey(candidate))) {
    candidate = buildNumberedFileName(baseName, index);
    index += 1;
  }
  usedNames.add(normalizeNameKey(candidate));
  return candidate;
}

export function buildArtifactSyncIdempotencyKey(parts: string[]): string {
  const stable = parts.join('\0');
  const digest = createHash('sha256').update(stable).digest('base64url').slice(0, 32);
  return `artifact-${digest}`;
}

function buildLocalSaveKey(input: {
  sourceType: ArtifactSaveSourceType;
  runId?: string | null;
  artifactKey: string;
  targetUri: string;
}): string {
  return [
    input.sourceType,
    input.runId?.trim() || '',
    input.artifactKey,
    input.targetUri,
  ].join('\0');
}

function buildDataCenterEntriesUrl(baseUrl: string, target: DataCenterArtifactTarget, pageNo: number): string {
  const query = new URLSearchParams({
    spaceType: target.spaceType,
    parentEntryId: target.parentEntryId || 'root',
    pageNo: String(pageNo),
    pageSize: String(DATA_CENTER_PAGE_SIZE),
  });
  if (target.spaceId) query.set('spaceId', target.spaceId);
  return `${baseUrl}/agent/v1/data-center/entries?${query.toString()}`;
}

function extractEntryNames(payload: unknown): string[] {
  const payloadObject = asObject(payload);
  const data = asObject(payloadObject.data ?? payload) as DataCenterEntryListPayload;
  const entries = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.records)
      ? data.records
      : [];
  return entries
    .map((entry) => typeof entry.name === 'string' ? entry.name.trim() : '')
    .filter(Boolean);
}

async function fetchExistingTargetNames(target: DataCenterArtifactTarget): Promise<Set<string>> {
  const token = await getStoToken();
  if (!token) throw Object.assign(new Error('未登录或 stoToken 已过期，请重新登录'), { statusCode: 401, errCode: 'UNAUTHORIZED' });

  const baseUrl = await resolveStoBaseUrl();
  const names = new Set<string>();
  for (let pageNo = 1; pageNo <= MAX_UNIQUE_NAME_ATTEMPTS; pageNo += 1) {
    const response = await fetch(buildDataCenterEntriesUrl(baseUrl, target, pageNo), {
      method: 'GET',
      headers: buildStoMemoryCenterAuthHeaders(token),
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { success: false, errMessage: text || `HTTP ${response.status}` };
    }
    const payloadObject = asObject(payload);
    if (!response.ok || payloadObject.success === false) {
      const errMessage = String(payloadObject.errMessage || payloadObject.error || `HTTP ${response.status}`);
      throw Object.assign(new Error(errMessage), {
        statusCode: response.status,
        errCode: typeof payloadObject.errCode === 'string' ? payloadObject.errCode : undefined,
      });
    }

    const pageNames = extractEntryNames(payload);
    for (const name of pageNames) {
      names.add(normalizeNameKey(name));
    }
    if (pageNames.length < DATA_CENTER_PAGE_SIZE) break;
  }
  return names;
}

function isDuplicateNameError(error: unknown): boolean {
  const err = error as { errCode?: string; message?: string };
  const text = `${err.errCode ?? ''} ${err.message ?? ''}`.toLocaleLowerCase();
  return /duplicate|conflict|already|exists|重复|已存在|同名|名称/.test(text);
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
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { success: false, errMessage: text || `HTTP ${response.status}` };
  }
  const payloadObject = asObject(payload);
  if (!response.ok || payloadObject.success === false) {
    const errMessage = String(payloadObject.errMessage || payloadObject.error || `HTTP ${response.status}`);
    throw Object.assign(new Error(errMessage), {
      statusCode: response.status,
      errCode: typeof payloadObject.errCode === 'string' ? payloadObject.errCode : undefined,
    });
  }
  const data = asObject(payloadObject.data ?? payload);
  return {
    entryId: typeof data.entryId === 'string'
      ? data.entryId
      : typeof data.id === 'string'
        ? data.id
        : null,
    pathLabel: typeof data.pathLabel === 'string'
      ? data.pathLabel
      : typeof data.fullPath === 'string'
        ? data.fullPath
        : null,
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
  const hasSharedTarget = targets.some((target) => target.spaceType !== 'qa_artifact');
  if (!hasSharedTarget) return targets;

  return targets.filter((target) => {
    const isQaRootTarget = target.spaceType === 'qa_artifact' && (target.parentEntryId || 'root') === 'root';
    if (!isQaRootTarget) return true;
    logger.info('[data-center-artifact-sync] skip qa root target mirrored by shared target', {
      targetUri: target.uri,
      targetLabel: target.label,
    });
    return false;
  });
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
  const targetNameSets = new Map<string, Set<string>>();
  for (const artifact of input.artifacts) {
    for (const target of input.targets) {
      const label = targetLabel(target);
      const idempotencyKey = buildArtifactSyncIdempotencyKey([
        input.idempotencyScope,
        artifact.artifactKey,
        target.uri,
      ]);
      const localSaveKey = buildLocalSaveKey({
        sourceType: input.sourceType,
        runId: input.runId,
        artifactKey: artifact.artifactKey,
        targetUri: target.uri,
      });

      let savePromise = inFlightArtifactSaves.get(localSaveKey);
      if (!savePromise) {
        savePromise = (async () => {
          let usedNames = targetNameSets.get(target.uri);
          if (!usedNames) {
            try {
              usedNames = await fetchExistingTargetNames(target);
            } catch (error) {
              usedNames = new Set<string>();
              logger.warn('[data-center-artifact-sync] existing names load failed', {
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                runId: input.runId,
                targetUri: target.uri,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            targetNameSets.set(target.uri, usedNames);
          }

          const existing = await repo.findExisting({
            sourceType: input.sourceType,
            runId: input.runId ?? null,
            artifactKey: artifact.artifactKey,
            targetUri: target.uri,
          });
          if (existing?.status === 'succeeded') {
            logger.info('[data-center-artifact-sync] skip already saved artifact', {
              sourceType: input.sourceType,
              sourceId: input.sourceId,
              runId: input.runId,
              artifactKey: artifact.artifactKey,
              targetUri: target.uri,
              recordId: existing.id,
            });
            return existing;
          }

          const requestedName = artifact.name || basename(artifact.filePath) || 'file';
          let uploadName = reserveUniqueFileName(requestedName, usedNames);
          let record = await repo.createOrUpdate({
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            sourceTitle: input.sourceTitle ?? null,
            runId: input.runId ?? null,
            sessionId: input.sessionId ?? null,
            artifactKey: artifact.artifactKey,
            artifactName: uploadName,
            localPath: artifact.filePath,
            targetUri: target.uri,
            targetLabel: label,
            status: 'uploading',
          });
          try {
            let result: Awaited<ReturnType<typeof uploadArtifact>> | null = null;
            for (let attempt = 1; attempt <= MAX_UNIQUE_NAME_ATTEMPTS; attempt += 1) {
              try {
                result = await uploadArtifact({
                  sourceType: input.sourceType,
                  sourceId: input.sourceId,
                  sourceTitle: input.sourceTitle,
                  sessionId: input.sessionId,
                  runId: input.runId,
                  artifact: { ...artifact, name: uploadName },
                  target,
                  idempotencyKey,
                });
                break;
              } catch (error) {
                if (!isDuplicateNameError(error) || attempt >= MAX_UNIQUE_NAME_ATTEMPTS) throw error;
                uploadName = reserveUniqueFileName(requestedName, usedNames);
                record = await repo.createOrUpdate({
                  sourceType: input.sourceType,
                  sourceId: input.sourceId,
                  sourceTitle: input.sourceTitle ?? null,
                  runId: input.runId ?? null,
                  sessionId: input.sessionId ?? null,
                  artifactKey: artifact.artifactKey,
                  artifactName: uploadName,
                  localPath: artifact.filePath,
                  targetUri: target.uri,
                  targetLabel: label,
                  status: 'uploading',
                });
              }
            }
            if (!result) throw new Error('产物上传失败');
            return repo.update(record.id, {
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
            return record;
          }
        })();
        inFlightArtifactSaves.set(localSaveKey, savePromise);
        savePromise.finally(() => {
          if (inFlightArtifactSaves.get(localSaveKey) === savePromise) {
            inFlightArtifactSaves.delete(localSaveKey);
          }
        }).catch(() => undefined);
      }
      records.push(await savePromise);
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
