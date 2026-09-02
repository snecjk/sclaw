import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  bindExternalService,
  listExternalServiceBindings,
  removeExternalService,
  upgradeExternalService,
} from '../../services/app-external-service-binding';
import { externalServiceApiClient } from '../../services/external-service-api-client';
import { getWorkspaceRootPath } from '../../services/session-catalog-service';
import { getStoAppBindingByWorkspaceId } from '../../services/sto-app-binding-store';
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
        serviceUid?: string;
        version?: string;
        alias?: string;
      }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const serviceUid = body.serviceUid?.trim() ?? '';
      if (!serviceUid) throw new Error('缺少 serviceUid');
      let version = body.version?.trim() ?? '';
      if (!version) {
        const page = await externalServiceApiClient.page({ pageNum: 1, pageSize: 100 });
        version = page.items.find((item) => item.serviceUid === serviceUid)?.latestVersion ?? '';
      }
      if (!version) throw new Error('外部服务没有可绑定的已发布版本');
      const binding = await getStoAppBindingByWorkspaceId(body.workspaceId?.trim() ?? '');
      if (!binding?.appCode) throw new Error('当前工作区尚未绑定云端应用，无法安装外部服务');
      const resolvedConfig = await externalServiceApiClient.resolveInstall(serviceUid, version, binding.appCode);
      const result = await bindExternalService({
        appPath,
        serviceUid,
        version,
        alias: body.alias?.trim() || defaultAlias(resolvedConfig.serviceId),
        resolvedConfig,
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
      const existing = (await listExternalServiceBindings(appPath)).find((item) => item.alias === alias);
      if (!existing) throw new Error('外部服务绑定不存在');
      const binding = await getStoAppBindingByWorkspaceId(body.workspaceId?.trim() ?? '');
      if (!binding?.appCode) throw new Error('当前工作区尚未绑定云端应用，无法升级外部服务');
      const resolvedConfig = await externalServiceApiClient.resolveInstall(
        existing.serviceUid, version, binding.appCode,
      );
      const result = await upgradeExternalService({ appPath, alias, version, resolvedConfig });
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
