import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  bindExternalService,
  listExternalServiceBindings,
  removeExternalService,
  upgradeExternalService,
} from '../../services/app-external-service-binding';
import { externalServiceApiClient } from '../../services/external-service-api-client';
import { getWorkspaceRootPath } from '../../services/session-catalog-service';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const PREFIX = '/api/app-external-services';

async function resolveAppPath(workspaceIdRaw: string | undefined): Promise<string> {
  const workspaceId = workspaceIdRaw?.trim() ?? '';
  if (!workspaceId) throw new Error('缺少 workspaceId');
  const appPath = await getWorkspaceRootPath(workspaceId);
  if (!appPath) throw new Error(`Workspace not found: ${workspaceId}`);
  return appPath;
}

function defaultAlias(serviceId: string): string {
  return serviceId.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

export async function handleAppExternalServiceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith(PREFIX)) return false;
  try {
    if (url.pathname === `${PREFIX}/search` && req.method === 'GET') {
      await resolveAppPath(url.searchParams.get('workspaceId') ?? '');
      const result = await externalServiceApiClient.page({
        keyword: url.searchParams.get('keyword')?.trim() || undefined,
        pageNum: 1,
        pageSize: 20,
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === `${PREFIX}/bindings` && req.method === 'GET') {
      const appPath = await resolveAppPath(url.searchParams.get('workspaceId') ?? '');
      sendJson(res, 200, {
        success: true,
        bindings: await listExternalServiceBindings(appPath),
      });
      return true;
    }

    if (url.pathname === `${PREFIX}/bind` && req.method === 'POST') {
      const body = await parseJsonBody<{
        workspaceId?: string;
        serviceId?: string;
        version?: string;
        alias?: string;
      }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const serviceId = body.serviceId?.trim() ?? '';
      if (!serviceId) throw new Error('缺少 serviceId');
      let version = body.version?.trim() ?? '';
      if (!version) {
        const page = await externalServiceApiClient.page({ keyword: serviceId, pageNum: 1, pageSize: 20 });
        version = page.items.find((item) => item.serviceId === serviceId)?.latestVersion ?? '';
      }
      if (!version) throw new Error('外部服务没有可绑定的已发布版本');
      const result = await bindExternalService({
        appPath,
        serviceId,
        version,
        alias: body.alias?.trim() || defaultAlias(serviceId),
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === `${PREFIX}/upgrade` && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId?: string; alias?: string; version?: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const alias = body.alias?.trim() ?? '';
      const version = body.version?.trim() ?? '';
      if (!alias || !version) throw new Error('upgrade 需要 alias 和 version');
      const result = await upgradeExternalService({ appPath, alias, version });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === `${PREFIX}/remove` && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId?: string; alias?: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const alias = body.alias?.trim() ?? '';
      if (!alias) throw new Error('remove 需要 alias');
      const result = await removeExternalService({ appPath, alias });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    return false;
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}
