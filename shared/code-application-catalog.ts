/**
 * STO policy code-application list/offline payload helpers.
 * Field names come from sai-cli policy.code-application.list / delete outputFields.
 */

export interface CodeApplicationRecord {
  applicationId: string;
  applicationName: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  headRevisionId?: string;
  headCommitSha?: string;
  applicationUid?: string;
  applicationCode?: string;
  sourceSha256?: string;
  description?: string;
  previewUrl?: string;
  developmentBranch?: string;
  gitlabProjectId?: string;
  devopsApplicationId?: string;
  pageType: CodeApplicationPageType;
}

export type CodeApplicationPageType = 'site' | 'assets';

export function normalizeCodeApplicationPageType(value: unknown): CodeApplicationPageType {
  return typeof value === 'string' && value.trim().toLowerCase() === 'assets'
    ? 'assets'
    : 'site';
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

export function normalizeCodeApplication(item: unknown): CodeApplicationRecord | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const applicationId = pickString(row.applicationId, row.appId, row.application_id);
  if (!applicationId) return null;
  return {
    applicationId,
    applicationName: pickString(row.applicationName, row.name, row.title, row.appName) ?? applicationId,
    status: pickString(row.status),
    createdAt: pickString(row.createdAt),
    updatedAt: pickString(row.updatedAt),
    headRevisionId: pickString(row.headRevisionId),
    headCommitSha: pickString(row.headCommitSha),
    applicationUid: pickString(row.applicationUid, row.appUid, row.uid),
    applicationCode: pickString(row.applicationCode),
    sourceSha256: pickString(row.sourceSha256, row.baseSourceSha256, row.headSourceSha256),
    description: pickString(row.description),
    previewUrl: pickString(row.previewUrl),
    developmentBranch: pickString(row.developmentBranch),
    gitlabProjectId: pickId(row.gitlabProjectId),
    devopsApplicationId: pickId(row.devopsApplicationId),
    pageType: normalizeCodeApplicationPageType(row.pageType),
  };
}

function extractArray(json: unknown): unknown[] {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const candidates = [root.data, root.apps, root.items, root.list, root.applications];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const nestedList = nested.apps ?? nested.items ?? nested.list ?? nested.data;
      if (Array.isArray(nestedList)) return nestedList;
    }
  }
  return [];
}

export function parseCodeApplicationList(json: unknown): CodeApplicationRecord[] {
  return extractArray(json)
    .map(normalizeCodeApplication)
    .filter((item): item is CodeApplicationRecord => Boolean(item));
}

export function parseCodeApplicationDetail(json: unknown): CodeApplicationRecord | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const candidates = [root.data, root];
  for (const candidate of candidates) {
    const normalized = normalizeCodeApplication(candidate);
    if (normalized) return normalized;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const fromNested = normalizeCodeApplication(nested.data ?? nested.application);
      if (fromNested) return fromNested;
    }
  }
  return null;
}

export function applicationCodeFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parsePolicyApiError(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (typeof record.errMessage === 'string' && record.errMessage.trim()) {
      return record.errMessage.trim();
    }
    if (typeof record.errorMsg === 'string' && record.errorMsg.trim()) {
      return record.errorMsg.trim();
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
  }
  return fallback;
}

