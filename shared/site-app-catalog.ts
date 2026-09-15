/**
 * Memory-center Site App HTTP payloads (`/api/v1/site-apps/*`).
 */

export type SiteAppPageType = 'site' | 'assets';

export interface SiteAppRecord {
  appCode: string;
  applicationName: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  headRevisionId?: string;
  headCommitSha?: string;
  headSourceSha256?: string;
  description?: string;
  previewUrl?: string;
  /** Permission-management URL configured by memory-center. */
  permissionsUrl?: string;
  gitlabProjectId?: string;
  devopsApplicationId?: string;
  /** DevOps Founder Group for site-deployments list/rollback. */
  devopsGroupName?: string;
  pageType: SiteAppPageType;
  iconUrl?: string;
}

export interface SiteAppPageResult {
  items: SiteAppRecord[];
  total: number;
  pageNum: number;
  pageSize: number;
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

export function normalizeSiteAppPageType(value: unknown): SiteAppPageType {
  return typeof value === 'string' && value.trim().toLowerCase() === 'assets'
    ? 'assets'
    : 'site';
}

export function normalizeSiteApp(item: unknown): SiteAppRecord | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const appCode = pickString(row.appCode, row.app_code, row.applicationCode, row.code);
  if (!appCode) return null;
  return {
    appCode,
    applicationName: pickString(row.applicationName, row.name, row.title, row.appName) ?? appCode,
    status: pickString(row.status),
    createdAt: pickString(row.createdAt, row.created_at),
    updatedAt: pickString(row.updatedAt, row.updated_at),
    headRevisionId: pickString(row.headRevisionId, row.head_revision_id, row.revisionId),
    headCommitSha: pickString(row.headCommitSha, row.head_commit_sha, row.commitSha),
    headSourceSha256: pickString(row.headSourceSha256, row.head_source_sha256, row.sourceSha256),
    description: pickString(row.description),
    previewUrl: pickString(
      row.previewUrl,
      row.preview_url,
      row.portalUrl,
      row.portal_url,
    ),
    permissionsUrl: pickString(row.permissionsUrl, row.permissions_url),
    gitlabProjectId: pickId(row.gitlabProjectId, row.gitlab_project_id),
    devopsApplicationId: pickId(row.devopsApplicationId, row.devops_application_id),
    /** DevOps Founder Group for site-deployments APIs (≠ git group_code). */
    devopsGroupName: pickString(
      row.devopsGroupName,
      row.devops_group_name,
      row.groupName,
      row.group_name,
      row.founderGroupName,
      row.founder_group_name,
    ),
    pageType: normalizeSiteAppPageType(row.pageType ?? row.page_type),
    iconUrl: pickString(row.iconUrl, row.icon_url),
  };
}

function extractArray(json: unknown): unknown[] {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const candidates = [root.data, root.items, root.list, root.apps, root.applications];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const nestedList = nested.items ?? nested.list ?? nested.data ?? nested.apps;
      if (Array.isArray(nestedList)) return nestedList;
    }
  }
  return [];
}

export function parseSiteAppList(json: unknown): SiteAppRecord[] {
  return extractArray(json)
    .map(normalizeSiteApp)
    .filter((item): item is SiteAppRecord => Boolean(item));
}

export function parseSiteAppDetail(json: unknown): SiteAppRecord | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const candidates = [root.data, root];
  for (const candidate of candidates) {
    const normalized = normalizeSiteApp(candidate);
    if (normalized) return normalized;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const fromNested = normalizeSiteApp(nested.data ?? nested.app ?? nested.application);
      if (fromNested) return fromNested;
    }
  }
  return null;
}

export function parseSiteAppPage(json: unknown): SiteAppPageResult {
  const root = json && typeof json === 'object' ? json as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object'
    ? root.data as Record<string, unknown>
    : root;
  const items = parseSiteAppList(data);
  const total = typeof data.total === 'number' && Number.isFinite(data.total)
    ? data.total
    : items.length;
  const pageNum = typeof data.pageNum === 'number' ? data.pageNum : 1;
  const pageSize = typeof data.pageSize === 'number' ? data.pageSize : items.length;
  return { items, total, pageNum, pageSize };
}

export function mergeSiteAppRecords(
  base: SiteAppRecord,
  overlay?: Partial<SiteAppRecord> | null,
): SiteAppRecord {
  if (!overlay) return base;
  return {
    ...base,
    applicationName: overlay.applicationName ?? base.applicationName,
    status: overlay.status ?? base.status,
    createdAt: overlay.createdAt ?? base.createdAt,
    updatedAt: overlay.updatedAt ?? base.updatedAt,
    headRevisionId: overlay.headRevisionId ?? base.headRevisionId,
    headCommitSha: overlay.headCommitSha ?? base.headCommitSha,
    headSourceSha256: overlay.headSourceSha256 ?? base.headSourceSha256,
    description: overlay.description ?? base.description,
    previewUrl: overlay.previewUrl ?? base.previewUrl,
    permissionsUrl: overlay.permissionsUrl ?? base.permissionsUrl,
    gitlabProjectId: overlay.gitlabProjectId ?? base.gitlabProjectId,
    devopsApplicationId: overlay.devopsApplicationId ?? base.devopsApplicationId,
    devopsGroupName: overlay.devopsGroupName ?? base.devopsGroupName,
    pageType: overlay.pageType ?? base.pageType,
    iconUrl: overlay.iconUrl ?? base.iconUrl,
  };
}
