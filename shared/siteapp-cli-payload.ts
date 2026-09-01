/**
 * sai-cli `siteapp` JSON response parsers.
 */

import { normalizeSiteAppPageType, type SiteAppPageType } from './site-app-catalog';

interface SaiCliLikeResult {
  ok: boolean;
  data?: unknown;
  error?: string | unknown;
  exitCode: number;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unwrapLegacyPolicyBody(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  if (!root) return null;
  const result = asRecord(root.result);
  const body = asRecord(result?.body);
  if (body) return asRecord(body.data) ?? body;
  return asRecord(root.data) ?? root;
}

export function unwrapSiteappCliBody(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  if (!root) return null;
  const cliData = asRecord(root.data);
  const result = asRecord(cliData?.result);
  const body = asRecord(result?.body);
  if (body && body.success === false) return null;
  const inner = asRecord(body?.data);
  if (inner) return inner;
  if (body) return body;
  return unwrapLegacyPolicyBody(data);
}

export interface SiteappSavedFile {
  localPath: string;
  fileName?: string;
  size?: number;
  contentType?: string;
}

export function parseSiteappSavedFiles(data: unknown): SiteappSavedFile[] {
  const root = asRecord(data);
  if (!root) return [];
  const cliData = asRecord(root.data);
  const result = asRecord(cliData?.result) ?? asRecord(root.result);
  const saved = result?.savedFiles ?? cliData?.savedFiles ?? root.savedFiles;
  if (!Array.isArray(saved)) return [];
  const files: SiteappSavedFile[] = [];
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

export interface SiteappApplicationCreate {
  appCode: string;
  name?: string;
  status?: string;
  pageType?: SiteAppPageType;
}

export function parseSiteappApplicationCreate(data: unknown): SiteappApplicationCreate | null {
  const body = unwrapSiteappCliBody(data);
  if (!body) return null;
  const appCode = pickString(body.appCode, body.app_code);
  if (!appCode) return null;
  const rawPageType = body.pageType ?? body.page_type;
  return {
    appCode,
    name: pickString(body.name, body.applicationName),
    status: pickString(body.status),
    ...(rawPageType != null && String(rawPageType).trim()
      ? { pageType: normalizeSiteAppPageType(rawPageType) }
      : {}),
  };
}

export interface SiteappRepositoryProvision {
  appCode: string;
  status?: string;
  headRevisionId?: string | null;
  headCommitSha?: string | null;
  headSourceSha256?: string | null;
  gitlabProjectId?: string;
  devopsApplicationId?: string;
  repositoryUrl?: string;
  repositoryPath?: string;
}

export function parseSiteappRepositoryProvision(data: unknown): SiteappRepositoryProvision | null {
  const body = unwrapSiteappCliBody(data);
  if (!body) return null;
  const appCode = pickString(body.appCode, body.app_code);
  if (!appCode) return null;
  return {
    appCode,
    status: pickString(body.status),
    headRevisionId: pickString(body.headRevisionId, body.head_revision_id) ?? null,
    headCommitSha: pickString(body.headCommitSha, body.head_commit_sha) ?? null,
    headSourceSha256: pickString(body.headSourceSha256, body.head_source_sha256) ?? null,
    gitlabProjectId: pickId(body.gitlabProjectId, body.gitlab_project_id),
    devopsApplicationId: pickId(body.devopsApplicationId, body.devops_application_id),
    repositoryUrl: pickString(body.repositoryUrl, body.repository_url),
    repositoryPath: pickString(body.repositoryPath, body.repository_path),
  };
}

export interface SiteappRevision {
  appCode?: string;
  revisionId?: string;
  status?: string;
  commitSha?: string;
  sourceSha256?: string;
  archiveSha256?: string;
  fileCount?: number;
  archiveSizeBytes?: number;
  expandedSizeBytes?: number;
  failureMessage?: string;
}

export function parseSiteappRevision(data: unknown): SiteappRevision | null {
  const body = unwrapSiteappCliBody(data);
  if (!body) return null;
  return {
    appCode: pickString(body.appCode, body.app_code),
    revisionId: pickString(body.revisionId, body.revision_id, body.versionId),
    status: pickString(body.status),
    commitSha: pickString(body.commitSha, body.commit_sha),
    sourceSha256: pickString(body.sourceSha256, body.source_sha256),
    archiveSha256: pickString(body.archiveSha256, body.archive_sha256),
    fileCount: typeof body.fileCount === 'number' ? body.fileCount : undefined,
    archiveSizeBytes: typeof body.archiveSizeBytes === 'number' ? body.archiveSizeBytes : undefined,
    expandedSizeBytes: typeof body.expandedSizeBytes === 'number' ? body.expandedSizeBytes : undefined,
    failureMessage: pickString(body.failureMessage, body.failure_message),
  };
}

export function siteappCliErrorMessage(result: SaiCliLikeResult): string {
  if (typeof result.error === 'string' && result.error.trim()) return result.error.trim();
  const topLevel = asRecord(result.error);
  const data = asRecord(result.data);
  const nested = asRecord(data?.error);
  const cliData = asRecord(data?.data);
  const resultNode = asRecord(cliData?.result);
  const body = asRecord(resultNode?.body);
  const message = pickString(
    topLevel?.message,
    nested?.message,
    body?.errMessage,
    body?.message,
    data?.message,
  );
  const errCode = pickString(body?.errCode, body?.err_code, data?.errCode);
  const traceId = pickString(body?.traceId, body?.trace_id, data?.traceId);
  const details = [errCode, traceId ? `traceId=${traceId}` : ''].filter(Boolean).join(', ');
  if (message && details) return `${message} (${details})`;
  return message || details || 'sai-cli 执行失败';
}

export function filePathFromSiteappLocalUri(uri: string): string {
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
