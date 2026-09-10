/**
 * Site App source sync helpers for memory-center HTTP
 * (`/api/v1/site-apps/source/commit|snapshot/{app_code}`).
 */

export const SITE_APP_SOURCE_TIMEOUT_MS = 180_000;

export const REMOTE_AHEAD_MESSAGE = 'REMOTE_AHEAD：请先下载远程最新代码并处理差异';

export interface SiteAppSourceBaseline {
  revisionId: string | null;
  commitSha: string | null;
  sourceSha256: string | null;
}

export interface SiteAppSourceRemote {
  revisionId: string;
  commitSha: string;
  sourceSha256: string;
  archiveSha256: string;
}

export interface SiteAppSourceCommitResult {
  appCode?: string;
  revisionId: string;
  status: string;
  commitSha: string;
  sourceSha256: string;
  archiveSha256: string;
  fileCount?: number;
}

export type SourcePullDecision =
  | 'already-synced'
  | 'local-ahead'
  | 'remote-ahead'
  | 'diverged'
  | 'initialize';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function unwrapData(json: unknown): Record<string, unknown> | null {
  const root = asRecord(json);
  if (!root) return null;
  return asRecord(root.data) ?? root;
}

export function parseSourceCommitResult(json: unknown): SiteAppSourceCommitResult | null {
  const body = unwrapData(json);
  if (!body) return null;
  const revisionId = pickString(body.revisionId, body.revision_id);
  const commitSha = pickString(body.commitSha, body.commit_sha);
  const sourceSha256 = pickString(body.sourceSha256, body.source_sha256);
  const archiveSha256 = pickString(body.archiveSha256, body.archive_sha256);
  const status = pickString(body.status) ?? '';
  if (!revisionId || !commitSha || !sourceSha256 || !archiveSha256) return null;
  return {
    appCode: pickString(body.appCode, body.app_code),
    revisionId,
    status,
    commitSha,
    sourceSha256,
    archiveSha256,
    fileCount: pickNumber(body.fileCount, body.file_count),
  };
}

function headerValue(
  headers: Headers | Record<string, string | undefined | null>,
  name: string,
): string | undefined {
  if (typeof (headers as Headers).get === 'function') {
    const value = (headers as Headers).get(name);
    return value?.trim() || undefined;
  }
  const record = headers as Record<string, string | undefined | null>;
  const found = Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1]?.trim() || undefined;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseSourceSnapshotHeaders(
  headers: Headers | Record<string, string | undefined | null>,
): SiteAppSourceRemote | null {
  const revisionId = headerValue(headers, 'X-STO-Revision-Id');
  const commitSha = headerValue(headers, 'X-STO-Commit-Sha');
  const sourceSha256 = headerValue(headers, 'X-STO-Source-Sha256');
  const archiveSha256 = unquote(
    headerValue(headers, 'X-STO-Archive-Sha256')
    ?? headerValue(headers, 'ETag')
    ?? '',
  );
  if (!revisionId || !commitSha || !sourceSha256 || !archiveSha256) return null;
  return { revisionId, commitSha, sourceSha256, archiveSha256 };
}

export function remoteMatchesBaseline(
  remote: Pick<SiteAppSourceRemote, 'revisionId' | 'commitSha' | 'sourceSha256'>,
  base: SiteAppSourceBaseline,
): boolean {
  return Boolean(
    base.revisionId
    && base.commitSha
    && base.sourceSha256
    && remote.revisionId === base.revisionId
    && remote.commitSha === base.commitSha
    && remote.sourceSha256 === base.sourceSha256,
  );
}

export function decideSourcePullAction(input: {
  base: SiteAppSourceBaseline;
  localSourceSha256: string | null;
  remote: Pick<SiteAppSourceRemote, 'revisionId' | 'commitSha' | 'sourceSha256'>;
  workspaceEmpty: boolean;
}): SourcePullDecision {
  const hasBase = Boolean(input.base.revisionId && input.base.commitSha && input.base.sourceSha256);
  if (!hasBase) {
    return input.workspaceEmpty ? 'initialize' : 'diverged';
  }
  const remoteEqualsBase = remoteMatchesBaseline(input.remote, input.base);
  const localEqualsBase = Boolean(
    input.localSourceSha256
    && input.base.sourceSha256
    && input.localSourceSha256 === input.base.sourceSha256,
  );
  if (remoteEqualsBase && localEqualsBase) return 'already-synced';
  if (remoteEqualsBase && !localEqualsBase) return 'local-ahead';
  if (!remoteEqualsBase && localEqualsBase) return 'remote-ahead';
  return 'diverged';
}

export function isVersionConflictError(errCode?: string): boolean {
  return errCode?.trim().toUpperCase() === 'VERSION_CONFLICT';
}
