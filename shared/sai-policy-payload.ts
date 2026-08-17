/**
 * Parse sai-cli policy JSON envelopes (create / detail / download / revision / upload).
 */

import { normalizeCodeApplication, type CodeApplicationRecord } from './code-application-catalog';

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function unwrapSaiPolicyBody(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  if (!root) return null;
  const result = asRecord(root.result);
  const body = asRecord(result?.body);
  if (body) return asRecord(body.data) ?? body;
  return asRecord(root.data) ?? root;
}

export function parseSaiCodeApplicationDetail(data: unknown): CodeApplicationRecord | null {
  const body = unwrapSaiPolicyBody(data);
  if (!body) return null;
  return normalizeCodeApplication(body);
}

export interface SaiSavedFile {
  localPath: string;
  fileName?: string;
  size?: number;
  contentType?: string;
}

export function parseSaiDownloadSavedFiles(data: unknown): SaiSavedFile[] {
  const body = unwrapSaiPolicyBody(data);
  if (!body) return [];
  const saved = body.savedFiles;
  if (!Array.isArray(saved)) return [];
  const files: SaiSavedFile[] = [];
  for (const item of saved) {
    const row = asRecord(item);
    const localPath = pickString(row?.localPath);
    if (!localPath) continue;
    files.push({
      localPath,
      fileName: pickString(row?.fileName),
      size: typeof row?.size === 'number' ? row.size : undefined,
      contentType: pickString(row?.contentType),
    });
  }
  return files;
}

export interface CodeRevisionRecord {
  applicationId?: string;
  revisionId?: string;
  status?: string;
  commitSha?: string;
  sourceSha256?: string;
  archiveSha256?: string;
  fileCount?: number;
  archiveSizeBytes?: number;
  expandedSizeBytes?: number;
  failureCode?: string;
  failureMessage?: string;
}

export function parseSaiCodeRevision(data: unknown): CodeRevisionRecord | null {
  const body = unwrapSaiPolicyBody(data);
  if (!body) return null;
  return {
    applicationId: pickString(body.applicationId),
    revisionId: pickString(body.revisionId, body.versionId),
    status: pickString(body.status),
    commitSha: pickString(body.commitSha),
    sourceSha256: pickString(body.sourceSha256),
    archiveSha256: pickString(body.archiveSha256),
    fileCount: typeof body.fileCount === 'number' ? body.fileCount : undefined,
    archiveSizeBytes: typeof body.archiveSizeBytes === 'number' ? body.archiveSizeBytes : undefined,
    expandedSizeBytes: typeof body.expandedSizeBytes === 'number' ? body.expandedSizeBytes : undefined,
    failureCode: pickString(body.failureCode),
    failureMessage: pickString(body.failureMessage),
  };
}

export function saiCliErrorMessage(result: {
  ok: boolean;
  error?: unknown;
  data?: unknown;
}): string {
  if (typeof result.error === 'string' && result.error.trim()) return result.error.trim();
  const topLevel = asRecord(result.error);
  const data = asRecord(result.data);
  const nested = asRecord(data?.error);
  const message = pickString(
    topLevel?.message,
    topLevel?.hint,
    topLevel?.code,
    nested?.message,
    data?.message,
    nested?.code,
  );
  return message || 'sai-cli 执行失败';
}

export function filePathFromSaiLocalUri(uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return trimmed.replace(/^file:\/\//, '');
    }
  }
  return trimmed;
}
