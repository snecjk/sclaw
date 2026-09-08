import type { IncomingMessage, ServerResponse } from 'http';
import { app } from 'electron';

import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { assertInternalHostApiRequest } from '../internal-request-auth';
import { appTemplateApiClient } from '../../services/app-template-api-client';
import { listLocalBuiltinAppTemplates } from '../../services/app-template-package-manager';
import {
  getBuiltinAppTemplateDebugStatus,
  openAppTemplateWorkspace,
  publishAppTemplateWorkspace,
  resetBuiltinAppTemplateDebugWorkspace,
  syncBuiltinAppTemplateDebugWorkspace,
} from '../../services/app-dev-service';
import {
  applyAppTemplateSourceImport,
  cancelAppTemplateSourceImport,
  getAppTemplateImportStatus,
  prepareAppTemplateSourceImport,
} from '../../services/app-template-source-import-service';

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${field} 不能为空`), { statusCode: 400 });
  }
  return value.trim();
}

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
      const localItems = !app.isPackaged
        ? await listLocalBuiltinAppTemplates(undefined, rawPageType ?? undefined)
        : [];
      let page;
      try {
        page = await appTemplateApiClient.page({
          pageType: rawPageType ?? undefined,
          status: 'ACTIVE',
          keyword: url.searchParams.get('keyword') ?? undefined,
          pageNum,
          pageSize,
        });
      } catch (error) {
        if (localItems.length === 0) throw error;
        page = { items: [], total: 0, pageNum, pageSize };
      }
      const remoteItems = page.items.map((item) => ({ ...item, source: 'memory-center' as const }));
      sendJson(res, 200, {
        success: true,
        ...page,
        items: [...localItems, ...remoteItems],
        total: localItems.length + page.total,
      });
      return true;
    }

    if (url.pathname === '/api/app-templates/workspaces' && req.method === 'POST') {
      const body = await parseJsonBody<{
        templateId?: string;
        pageType?: 'site' | 'assets';
        name?: string;
        description?: string;
        latestVersion?: string;
        source?: 'local-resource' | 'memory-center';
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
        source: body.source,
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (
      url.pathname === '/api/app-templates/workspaces/import-source/status'
      && req.method === 'GET'
    ) {
      assertInternalHostApiRequest(req);
      const result = await getAppTemplateImportStatus({
        workspaceId: requireString(url.searchParams.get('workspaceId'), 'workspaceId'),
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (
      url.pathname === '/api/app-templates/workspaces/builtin-debug/status'
      && req.method === 'GET'
    ) {
      assertInternalHostApiRequest(req);
      const result = await getBuiltinAppTemplateDebugStatus(
        requireString(url.searchParams.get('workspaceId'), 'workspaceId'),
      );
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (
      url.pathname === '/api/app-templates/workspaces/builtin-debug/sync'
      && req.method === 'POST'
    ) {
      assertInternalHostApiRequest(req);
      const body = await parseJsonBody<{ workspaceId?: unknown; confirmed?: unknown }>(req);
      if (body.confirmed !== true) {
        throw Object.assign(new Error('同步回内置模板前必须明确确认'), { statusCode: 400 });
      }
      const result = await syncBuiltinAppTemplateDebugWorkspace(
        requireString(body.workspaceId, 'workspaceId'),
      );
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (
      url.pathname === '/api/app-templates/workspaces/builtin-debug/reset'
      && req.method === 'POST'
    ) {
      assertInternalHostApiRequest(req);
      const body = await parseJsonBody<{ workspaceId?: unknown; confirmed?: unknown }>(req);
      if (body.confirmed !== true) {
        throw Object.assign(new Error('重新加载内置模板前必须明确确认'), { statusCode: 400 });
      }
      const result = await resetBuiltinAppTemplateDebugWorkspace(
        requireString(body.workspaceId, 'workspaceId'),
      );
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (
      url.pathname === '/api/app-templates/workspaces/import-source/prepare'
      && req.method === 'POST'
    ) {
      assertInternalHostApiRequest(req);
      const body = await parseJsonBody<{ workspaceId?: unknown; sourcePath?: unknown }>(req);
      const result = await prepareAppTemplateSourceImport({
        workspaceId: requireString(body.workspaceId, 'workspaceId'),
        sourcePath: typeof body.sourcePath === 'string' ? body.sourcePath : undefined,
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (
      url.pathname === '/api/app-templates/workspaces/import-source/apply'
      && req.method === 'POST'
    ) {
      assertInternalHostApiRequest(req);
      const body = await parseJsonBody<{ workspaceId?: unknown; importToken?: unknown }>(req);
      const result = await applyAppTemplateSourceImport({
        workspaceId: requireString(body.workspaceId, 'workspaceId'),
        importToken: requireString(body.importToken, 'importToken'),
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (
      url.pathname === '/api/app-templates/workspaces/import-source/cancel'
      && req.method === 'POST'
    ) {
      assertInternalHostApiRequest(req);
      const body = await parseJsonBody<{ workspaceId?: unknown; importToken?: unknown }>(req);
      const result = await cancelAppTemplateSourceImport({
        workspaceId: requireString(body.workspaceId, 'workspaceId'),
        importToken: requireString(body.importToken, 'importToken'),
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

    const deleteMatch = url.pathname.match(/^\/api\/app-templates\/([^/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      assertInternalHostApiRequest(req);
      const templateId = requireString(decodeURIComponent(deleteMatch[1]!), 'templateId');
      const result = await appTemplateApiClient.delete(templateId);
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
