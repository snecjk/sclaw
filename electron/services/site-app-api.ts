/**
 * Memory-center Site App HTTP API (`/api/v1/site-apps/*`).
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  mergeSiteAppRecords,
  parseSiteAppDetail,
  parseSiteAppPage,
  type SiteAppPageType,
  type SiteAppRecord,
} from '../../shared/site-app-catalog';
import {
  SITE_APP_SOURCE_TIMEOUT_MS,
  parseSourceCommitResult,
  parseSourceSnapshotHeaders,
  type SiteAppSourceCommitResult,
  type SiteAppSourceRemote,
} from '../../shared/site-app-source-sync';
import type { SiteAppGitGroupParams } from '../../shared/site-app-git-group';
import { logger } from '../utils/logger';
import { buildSiteAppCreateParams, resolveSiteappDeployCreateParams } from '../utils/siteapp-cli';
import {
  memoryCenterFetchBinaryForSession,
  memoryCenterFetchForSession,
  StoMemoryApiError,
  type MemoryCenterFetchInit,
} from './sto-memory-api-fetch';

const LIST_PAGE_SIZE = 100;
const SITE_APP_LOG_MAX_CHARS = 80_000;

function serializeForSiteAppLog(value: unknown): string {
  try {
    const text = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      return item;
    });
    if (text.length <= SITE_APP_LOG_MAX_CHARS) return text;
    return `${text.slice(0, SITE_APP_LOG_MAX_CHARS)}…[truncated ${text.length - SITE_APP_LOG_MAX_CHARS} chars]`;
  } catch {
    return String(value);
  }
}

function serializeSiteAppError(error: unknown): unknown {
  if (error instanceof StoMemoryApiError) {
    return {
      name: error.name,
      message: error.message,
      statusCode: error.statusCode,
      errCode: error.errCode,
      traceId: error.traceId,
      data: error.data,
      payload: error.payload,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

async function fetchSiteAppJson(
  action: string,
  path: string,
  init: MemoryCenterFetchInit,
  requestLog: unknown,
): Promise<unknown> {
  logger.info(
    `[site-app] ${action} request path=${path} body=${serializeForSiteAppLog(requestLog)}`,
  );
  try {
    const json = await memoryCenterFetchForSession(path, init);
    logger.info(
      `[site-app] ${action} response path=${path} body=${serializeForSiteAppLog(json)}`,
    );
    return json;
  } catch (error) {
    logger.error(
      `[site-app] ${action} error path=${path} body=${serializeForSiteAppLog(serializeSiteAppError(error))}`,
    );
    throw error;
  }
}

export async function pageSiteApps(input?: {
  pageNum?: number;
  pageSize?: number;
}): Promise<import('../../shared/site-app-catalog').SiteAppPageResult> {
  const pageNum = input?.pageNum ?? 1;
  const pageSize = input?.pageSize ?? LIST_PAGE_SIZE;
  const path = '/api/v1/site-apps/page';
  const requestBody = { data: { pageNum, pageSize } };
  const json = await fetchSiteAppJson('action=page', path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  }, requestBody);
  return parseSiteAppPage(json);
}

export async function listSiteApps(): Promise<SiteAppRecord[]> {
  const all: SiteAppRecord[] = [];
  let pageNum = 1;
  for (;;) {
    const page = await pageSiteApps({ pageNum, pageSize: LIST_PAGE_SIZE });
    all.push(...page.items);
    if (page.items.length < LIST_PAGE_SIZE || all.length >= page.total) break;
    pageNum += 1;
  }
  return all;
}

export async function getSiteApp(appCode: string): Promise<SiteAppRecord> {
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  const path = `/api/v1/site-apps/${encodeURIComponent(code)}`;
  const json = await fetchSiteAppJson('action=detail', path, { method: 'GET' }, { app_code: code });
  const detail = parseSiteAppDetail(json);
  if (!detail?.appCode) throw new Error('查询应用详情失败');
  return detail;
}

export async function createSiteApp(input: {
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  pageType?: SiteAppPageType | null;
}): Promise<SiteAppRecord> {
  const params = buildSiteAppCreateParams(input);
  const path = '/api/v1/site-apps';
  const requestBody = {
    name: params.name,
    description: params.description ?? null,
    page_type: params.page_type,
    icon_url: params.icon_url ?? null,
  };
  const json = await fetchSiteAppJson('action=create', path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  }, requestBody);
  const created = parseSiteAppDetail(json);
  if (!created?.appCode) throw new Error('创建应用失败：响应缺少 app_code');
  return created;
}

export async function updateSiteApp(
  appCode: string,
  body: Record<string, unknown>,
): Promise<SiteAppRecord> {
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  const path = `/api/v1/site-apps/${encodeURIComponent(code)}/update`;
  const json = await fetchSiteAppJson('action=update', path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { app_code: code, ...body });
  const detail = parseSiteAppDetail(json);
  if (!detail?.appCode) throw new Error('更新应用失败');
  return detail;
}

export async function archiveSiteApp(appCode: string): Promise<void> {
  await updateSiteApp(appCode, { status: 'archived' });
  logger.info(`[site-app] action=archive success appCode=${appCode.trim()}`);
}

export async function commitSiteAppSource(input: {
  appCode: string;
  archivePath: string;
  metadata: {
    revisionId: string;
    revisionMessage: string;
    baseRevisionId?: string | null;
    parentRevisionId?: string | null;
    mergeParentRevisionId?: string | null;
    sourceSha256: string;
    archiveSha256: string;
    archiveSizeBytes: number;
    expandedSizeBytes: number;
    fileCount: number;
  };
  /** First-commit Git Group binding; omit on subsequent commits. Both fields required together. */
  gitGroup?: SiteAppGitGroupParams | null;
}): Promise<SiteAppSourceCommitResult> {
  const appCode = input.appCode.trim();
  if (!appCode) throw new Error('缺少 app_code');
  const archive = await readFile(input.archivePath);
  if (archive.length === 0) throw new Error('源码包为空');

  const metadata = {
    revision_id: input.metadata.revisionId,
    revision_message: input.metadata.revisionMessage,
    base_revision_id: input.metadata.baseRevisionId ?? null,
    parent_revision_id: input.metadata.parentRevisionId ?? null,
    merge_parent_revision_id: input.metadata.mergeParentRevisionId ?? null,
    source_sha256: input.metadata.sourceSha256,
    archive_sha256: input.metadata.archiveSha256,
    archive_size_bytes: input.metadata.archiveSizeBytes,
    expanded_size_bytes: input.metadata.expandedSizeBytes,
    file_count: input.metadata.fileCount,
  };
  const groupType = input.gitGroup?.groupType?.trim() || '';
  const groupCode = input.gitGroup?.groupCode?.trim() || '';
  if ((groupType && !groupCode) || (!groupType && groupCode)) {
    throw new Error('group_type 与 group_code 必须同时传');
  }

  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  form.append(
    'source_file',
    new Blob([new Uint8Array(archive)], { type: 'application/gzip' }),
    'source.tar.gz',
  );
  if (groupType && groupCode) {
    form.append('group_type', groupType);
    form.append('group_code', groupCode);
  }

  const path = `/api/v1/site-apps/source/commit/${encodeURIComponent(appCode)}`;
  const json = await fetchSiteAppJson('action=source-commit', path, {
    method: 'POST',
    body: form,
    timeoutMs: SITE_APP_SOURCE_TIMEOUT_MS,
  }, {
    app_code: appCode,
    metadata,
    ...(groupType && groupCode ? { group_type: groupType, group_code: groupCode } : {}),
    source_file: {
      filename: 'source.tar.gz',
      contentType: 'application/gzip',
      bytes: archive.length,
    },
  });
  const revision = parseSourceCommitResult(json);
  if (!revision) throw new Error('提交源码失败：响应缺少版本信息');
  return revision;
}

export async function downloadSiteAppSourceSnapshot(
  appCode: string,
  options?: { revisionId?: string | null },
): Promise<{
  archive: Buffer;
  remote: SiteAppSourceRemote;
}> {
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  const revisionId = options?.revisionId?.trim() || '';
  const query = revisionId ? `?revision_id=${encodeURIComponent(revisionId)}` : '';
  const path = `/api/v1/site-apps/source/snapshot/${encodeURIComponent(code)}${query}`;
  logger.info(
    `[site-app] action=source-snapshot request path=${path} body=${serializeForSiteAppLog({
      app_code: code,
      revision_id: revisionId || null,
    })}`,
  );
  try {
    const { buffer, headers } = await memoryCenterFetchBinaryForSession(path, {
      method: 'GET',
      timeoutMs: SITE_APP_SOURCE_TIMEOUT_MS,
    });
    if (buffer.length === 0) throw new Error('下载文件为空');
    const remote = parseSourceSnapshotHeaders(headers);
    const headerLog = {
      'X-STO-Revision-Id': headers.get('X-STO-Revision-Id'),
      'X-STO-Commit-Sha': headers.get('X-STO-Commit-Sha'),
      'X-STO-Source-Sha256': headers.get('X-STO-Source-Sha256'),
      'X-STO-Archive-Sha256': headers.get('X-STO-Archive-Sha256'),
      ETag: headers.get('ETag'),
      'Content-Type': headers.get('Content-Type'),
      'Content-Length': headers.get('Content-Length'),
    };
    logger.info(
      `[site-app] action=source-snapshot response path=${path} ` +
      `body=${serializeForSiteAppLog({ bytes: buffer.length, headers: headerLog, remote })}`,
    );
    if (!remote) {
      throw new Error('下载失败：缺少 revision / commit / sha256 响应头');
    }
    const actualSha = createHash('sha256').update(buffer).digest('hex');
    if (actualSha !== remote.archiveSha256.toLowerCase()) {
      throw new Error('下载校验失败：archiveSha256 与响应头不一致');
    }
    return { archive: buffer, remote };
  } catch (error) {
    logger.error(
      `[site-app] action=source-snapshot error path=${path} body=${serializeForSiteAppLog(serializeSiteAppError(error))}`,
    );
    throw error;
  }
}

export async function listSiteAppSourceRevisions(
  appCode: string,
  limit = 50,
): Promise<import('../../shared/site-app-source-revisions').SiteAppSourceRevision[]> {
  const { parseSiteAppSourceRevisions } = await import('../../shared/site-app-source-revisions');
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  const capped = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
  const path =
    `/api/v1/site-apps/${encodeURIComponent(code)}/source/revisions?limit=${capped}`;
  const json = await fetchSiteAppJson(
    'action=source-revisions',
    path,
    { method: 'GET', timeoutMs: SITE_APP_SOURCE_TIMEOUT_MS },
    { app_code: code, limit: capped },
  );
  return parseSiteAppSourceRevisions(json);
}

export async function listSiteAppDeployments(input: {
  appCode: string;
  groupName: string;
}): Promise<import('../../shared/site-app-deployments').SiteAppDeploymentRecord[]> {
  const { parseSiteAppDeploymentList } = await import('../../shared/site-app-deployments');
  const appCode = input.appCode.trim();
  const groupName = input.groupName.trim();
  if (!appCode) throw new Error('缺少 app_code');
  if (!groupName) throw new Error('缺少 group_name');
  const path =
    `/api/v1/site-apps/site-deployments/${encodeURIComponent(appCode)}` +
    `?group_name=${encodeURIComponent(groupName)}`;
  const json = await fetchSiteAppJson(
    'action=site-deployments',
    path,
    { method: 'GET', timeoutMs: SITE_APP_SOURCE_TIMEOUT_MS },
    { app_code: appCode, group_name: groupName },
  );
  return parseSiteAppDeploymentList(json);
}

export async function rollbackSiteAppDeployment(input: {
  appCode: string;
  groupName: string;
  targetRecordId: number;
}): Promise<import('../../shared/site-app-deployments').SiteAppDeployRollbackResult> {
  const { parseSiteAppDeployRollbackResult } = await import('../../shared/site-app-deployments');
  const appCode = input.appCode.trim();
  const groupName = input.groupName.trim();
  const targetRecordId = Math.trunc(input.targetRecordId);
  if (!appCode) throw new Error('缺少 app_code');
  if (!groupName) throw new Error('缺少 group_name');
  if (!Number.isFinite(targetRecordId) || targetRecordId <= 0) {
    throw new Error('缺少 target_record_id');
  }
  const path = `/api/v1/site-apps/site-deployments/rollback/${encodeURIComponent(appCode)}`;
  const body = { group_name: groupName, target_record_id: targetRecordId };
  const json = await fetchSiteAppJson(
    'action=site-deployments-rollback',
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: SITE_APP_SOURCE_TIMEOUT_MS,
    },
    { app_code: appCode, ...body },
  );
  return parseSiteAppDeployRollbackResult(json);
}

/** HTTP detail may omit gitlab fields until the first source commit creates the repository. */
export async function enrichSiteAppRecord(record: SiteAppRecord): Promise<SiteAppRecord> {
  if (record.gitlabProjectId && record.headRevisionId) return record;
  try {
    const detail = await getSiteApp(record.appCode);
    return mergeSiteAppRecords(record, detail);
  } catch (error) {
    logger.warn(`[site-app] enrich detail fallback appCode=${record.appCode}:`, error);
    return record;
  }
}

export async function getSiteAppWithRepository(appCode: string): Promise<SiteAppRecord> {
  const detail = await getSiteApp(appCode);
  return enrichSiteAppRecord(detail);
}

const SITE_APP_DEPLOY_TIMEOUT_MS = 120_000;
const SITE_APP_MENU_TIMEOUT_MS = 60_000;

function postSiteAppCli(
  action: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return fetchSiteAppJson(action, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs,
  }, body);
}

/**
 * Deploy create rejects draft Site Apps (`SITE_APP_GIT_APP_STATUS_INVALID` / HTTP 409).
 * Promote draft → active before creating a deployment.
 */
export async function ensureSiteAppActiveForDeploy(appCode: string): Promise<SiteAppRecord> {
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  const app = await getSiteApp(code);
  const status = app.status?.trim().toLowerCase() ?? '';
  if (status === 'active') return app;
  if (status === 'archived') {
    throw new Error('应用已归档，无法发布');
  }
  if (status === 'draft') {
    logger.info(`[site-app] action=activate-for-deploy appCode=${code}`);
    return await updateSiteApp(code, { status: 'active' });
  }
  throw new Error(`当前应用状态不允许发布：${app.status ?? '未知'}（需要 active）`);
}

export async function createSiteAppDeploy(input: {
  appCode: string;
  env: string;
  requestId?: string;
  deploymentVersion?: string;
}): Promise<unknown> {
  const params = resolveSiteappDeployCreateParams(input);
  return postSiteAppCli(
    'action=deploy-create',
    '/api/v1/cli/site-app/deploy/create',
    params,
    SITE_APP_DEPLOY_TIMEOUT_MS,
  );
}

export async function refreshSiteAppDeploy(input: {
  appCode: string;
  deploymentId: string;
}): Promise<unknown> {
  const appCode = input.appCode.trim();
  const deploymentId = input.deploymentId.trim();
  if (!appCode) throw new Error('缺少 app_code');
  if (!deploymentId) throw new Error('缺少 deployment_id');
  return postSiteAppCli(
    'action=deploy-refresh',
    '/api/v1/cli/site-app/deploy/refresh',
    { app_code: appCode, deployment_id: deploymentId },
    SITE_APP_DEPLOY_TIMEOUT_MS,
  );
}

export async function syncSiteAppMenus(params: Record<string, unknown>): Promise<unknown> {
  const appCode = typeof params.app_code === 'string' ? params.app_code.trim() : '';
  if (!appCode) throw new Error('缺少 app_code');
  return postSiteAppCli(
    'action=menu-replace',
    '/api/v1/cli/site-app/menus/replace',
    params,
    SITE_APP_MENU_TIMEOUT_MS,
  );
}

export async function listSiteAppMenus(appCode: string): Promise<unknown> {
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  return postSiteAppCli(
    'action=menu-list',
    '/api/v1/cli/site-app/menu/list',
    { app_code: code },
    SITE_APP_MENU_TIMEOUT_MS,
  );
}
