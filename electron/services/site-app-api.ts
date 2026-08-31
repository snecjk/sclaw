/**
 * Memory-center Site App HTTP API (`/api/v1/site-apps/*`).
 */

import {
  mergeSiteAppRecords,
  parseSiteAppDetail,
  parseSiteAppPage,
  type SiteAppRecord,
} from '../../shared/site-app-catalog';
import {
  type SiteappRepositoryProvision,
} from '../../shared/siteapp-cli-payload';
import { logger } from '../utils/logger';
import { siteappRepositoryProvision } from '../utils/siteapp-cli';
import {
  memoryCenterFetchForSession,
  StoMemoryApiError,
} from './sto-memory-api-fetch';

const LIST_PAGE_SIZE = 100;

export async function pageSiteApps(input?: {
  pageNum?: number;
  pageSize?: number;
}): Promise<import('../../shared/site-app-catalog').SiteAppPageResult> {
  const pageNum = input?.pageNum ?? 1;
  const pageSize = input?.pageSize ?? LIST_PAGE_SIZE;
  logger.info(`[site-app] action=page pageNum=${pageNum} pageSize=${pageSize}`);
  const json = await memoryCenterFetchForSession('/api/v1/site-apps/page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        pageNum,
        pageSize,
      },
    }),
  });
  const page = parseSiteAppPage(json);
  logger.info(`[site-app] action=page count=${page.items.length} total=${page.total}`);
  return page;
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
  logger.info(`[site-app] action=detail appCode=${code}`);
  const json = await memoryCenterFetchForSession(
    `/api/v1/site-apps/${encodeURIComponent(code)}`,
    { method: 'GET' },
  );
  const detail = parseSiteAppDetail(json);
  if (!detail?.appCode) throw new Error('查询应用详情失败');
  return detail;
}

export async function updateSiteApp(
  appCode: string,
  body: Record<string, unknown>,
): Promise<SiteAppRecord> {
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  logger.info(`[site-app] action=update appCode=${code}`);
  const json = await memoryCenterFetchForSession(
    `/api/v1/site-apps/${encodeURIComponent(code)}/update`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const detail = parseSiteAppDetail(json);
  if (!detail?.appCode) throw new Error('更新应用失败');
  return detail;
}

export async function archiveSiteApp(appCode: string): Promise<void> {
  await updateSiteApp(appCode, { status: 'archived' });
  logger.info(`[site-app] action=archive success appCode=${appCode.trim()}`);
}

export function mergeProvisionIntoSiteApp(
  record: SiteAppRecord,
  provisioned: SiteappRepositoryProvision,
): SiteAppRecord {
  return mergeSiteAppRecords(record, {
    status: provisioned.status,
    headRevisionId: provisioned.headRevisionId ?? undefined,
    headCommitSha: provisioned.headCommitSha ?? undefined,
    gitlabProjectId: provisioned.gitlabProjectId,
    devopsApplicationId: provisioned.devopsApplicationId,
  });
}

/** HTTP detail may omit gitlab fields; repository provision fills them. */
export async function enrichSiteAppRecord(record: SiteAppRecord): Promise<SiteAppRecord> {
  if (record.gitlabProjectId) return record;
  const provisioned = await siteappRepositoryProvision(record.appCode);
  return mergeProvisionIntoSiteApp(record, provisioned);
}

export async function getSiteAppWithRepository(appCode: string): Promise<SiteAppRecord> {
  const detail = await getSiteApp(appCode);
  return enrichSiteAppRecord(detail);
}

/**
 * Deploy create rejects draft Site Apps (`SITE_APP_GIT_APP_STATUS_INVALID` / HTTP 409).
 * Promote draft → active before calling `siteapp deploy create`.
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

/**
 * sai-cli wraps HTTP failures as `downstream request failed: 409` without errCode.
 * Re-call the same memory-center CLI route to surface errMessage for UI/logs.
 */
export async function probeSiteAppDeployCreateDownstream(
  params: Record<string, string>,
): Promise<string | null> {
  try {
    await memoryCenterFetchForSession('/api/v1/cli/site-app/deploy/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return null;
  } catch (error) {
    if (error instanceof StoMemoryApiError) {
      logger.error(
        `[site-app] deploy create downstream rejected status=${error.statusCode} ${error.message}`,
      );
      return error.message;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[site-app] deploy create downstream probe failed ${message}`);
    return message;
  }
}

export async function probeSiteAppDeployRefreshDownstream(
  params: Record<string, string>,
): Promise<string | null> {
  try {
    await memoryCenterFetchForSession('/api/v1/cli/site-app/deploy/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return null;
  } catch (error) {
    if (error instanceof StoMemoryApiError) {
      logger.error(
        `[site-app] deploy refresh downstream rejected status=${error.statusCode} ${error.message}`,
      );
      return error.message;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[site-app] deploy refresh downstream probe failed ${message}`);
    return message;
  }
}
