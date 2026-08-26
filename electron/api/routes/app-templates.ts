import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { appTemplateApiClient } from '../../services/app-template-api-client';
import {
  openAppTemplateWorkspace,
  publishAppTemplateWorkspace,
} from '../../services/app-dev-service';

export async function handleAppTemplateRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/app-templates')) return false;

  try {
    if (url.pathname === '/api/app-templates' && req.method === 'GET') {
      const rawPageType = url.searchParams.get('pageType');
      if (rawPageType !== null && rawPageType !== 'site' && rawPageType !== 'assets') {
        throw Object.assign(new Error('pageType 仅支持 site 或 assets'), { statusCode: 400 });
      }
      const pageNum = Number(url.searchParams.get('pageNum') || 1);
      const pageSize = Number(url.searchParams.get('pageSize') || 100);
      if (!Number.isInteger(pageNum) || pageNum < 1) {
        throw Object.assign(new Error('pageNum 必须是正整数'), { statusCode: 400 });
      }
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Object.assign(new Error('pageSize 必须是 1 到 100 的整数'), { statusCode: 400 });
      }
      const page = await appTemplateApiClient.page({
        pageType: rawPageType ?? undefined,
        status: 'ACTIVE',
        keyword: url.searchParams.get('keyword') ?? undefined,
        pageNum,
        pageSize,
      });
      sendJson(res, 200, { success: true, ...page });
      return true;
    }

    if (url.pathname === '/api/app-templates/workspaces' && req.method === 'POST') {
      const body = await parseJsonBody<{
        templateId?: string;
        pageType?: 'site' | 'assets';
        name?: string;
        description?: string;
        latestVersion?: string;
      }>(req);
      if (body.pageType !== 'site' && body.pageType !== 'assets') {
        throw Object.assign(new Error('pageType 仅支持 site 或 assets'), { statusCode: 400 });
      }
      const result = await openAppTemplateWorkspace({
        templateId: body.templateId,
        pageType: body.pageType,
        name: body.name ?? '',
        description: body.description,
        latestVersion: body.latestVersion,
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-templates/publish' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId?: string; confirmed?: boolean }>(req);
      if (body.confirmed !== true) {
        throw Object.assign(new Error('发布模板前必须明确确认'), { statusCode: 400 });
      }
      const result = await publishAppTemplateWorkspace({ workspaceId: body.workspaceId ?? '' });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    const versionsMatch = url.pathname.match(/^\/api\/app-templates\/([^/]+)\/versions$/);
    if (versionsMatch && req.method === 'GET') {
      const versions = await appTemplateApiClient.listVersions(decodeURIComponent(versionsMatch[1]!));
      sendJson(res, 200, { success: true, versions });
      return true;
    }

    return false;
  } catch (error) {
    const errorStatus = Number(
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
        : 500,
    );
    const statusCode = Number.isInteger(errorStatus) && errorStatus >= 400 && errorStatus < 600
      ? errorStatus
      : 500;
    sendJson(res, statusCode, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}
