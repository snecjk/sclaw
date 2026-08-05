/**
 * Host API — /api/connectors*
 */
import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getConnectorService } from '../../connectors';
import { ConnectorError } from '../../connectors/errors';
import { logger } from '../../utils/logger';

function errorPayload(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ConnectorError) {
    const status =
      error.code === 'NOT_FOUND' ? 404 : error.code === 'BUSY' ? 409 : 400;
    return {
      status,
      body: {
        success: false,
        errCode: error.code,
        errMessage: error.message,
        error: error.message,
        data: null,
      },
    };
  }
  return {
    status: 500,
    body: {
      success: false,
      errCode: '500',
      errMessage: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error),
      data: null,
    },
  };
}

export async function handleConnectorRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const service = getConnectorService();

  try {
    if (url.pathname === '/api/connectors' && req.method === 'GET') {
      const refresh = url.searchParams.get('refresh') !== '0';
      const items = await service.list({ refresh });
      sendJson(res, 200, { success: true, data: items });
      return true;
    }

    const connectMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)\/connect$/);
    if (connectMatch && req.method === 'POST') {
      const id = decodeURIComponent(connectMatch[1]);
      const item = await service.connect(id, ctx.mainWindow);
      sendJson(res, 200, { success: true, data: item });
      return true;
    }

    const tokenConnectMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)\/token-connect$/);
    if (tokenConnectMatch && req.method === 'POST') {
      const id = decodeURIComponent(tokenConnectMatch[1]);
      const body = await parseJsonBody<{ serverUrl?: string; token?: string }>(req);
      const serverUrl = typeof body.serverUrl === 'string' ? body.serverUrl.trim() : '';
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      if (!serverUrl || !token) {
        sendJson(res, 400, {
          success: false,
          errCode: 'AUTH_FAILED',
          errMessage: '请填写服务器地址和 Personal Access Token',
          error: '请填写服务器地址和 Personal Access Token',
          data: null,
        });
        return true;
      }
      const item = await service.tokenConnect(id, { serverUrl, token }, ctx.mainWindow);
      sendJson(res, 200, { success: true, data: item });
      return true;
    }

    const disconnectMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)\/disconnect$/);
    if (disconnectMatch && req.method === 'POST') {
      const id = decodeURIComponent(disconnectMatch[1]);
      const item = await service.disconnect(id);
      sendJson(res, 200, { success: true, data: item });
      return true;
    }

    const statusMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)\/status$/);
    if (statusMatch && req.method === 'GET') {
      const id = decodeURIComponent(statusMatch[1]);
      const item = await service.refreshStatus(id);
      const progress = service.getProgress(id);
      sendJson(res, 200, { success: true, data: { ...item, progress } });
      return true;
    }

    const reauthMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)\/reauth$/);
    if (reauthMatch && req.method === 'POST') {
      const id = decodeURIComponent(reauthMatch[1]);
      const body = await parseJsonBody<{ errorText?: string }>(req);
      const errorText =
        typeof body.errorText === 'string' && body.errorText.trim()
          ? body.errorText.trim()
          : 'auth expired';
      const { ensureConnectorReauthFromRuntime } = await import(
        '../../connectors/cli-reauth'
      );
      await service.list({ refresh: false });
      const descriptor = service.getDescriptor(id);
      if (!descriptor) {
        sendJson(res, 404, {
          success: false,
          errCode: 'NOT_FOUND',
          errMessage: `连接器不存在：${id}`,
          data: null,
        });
        return true;
      }
      const runtime =
        descriptor.runtime && typeof descriptor.runtime === 'object'
          ? (descriptor.runtime as Record<string, unknown>)
          : {};
      const binary =
        typeof runtime.binary === 'string' ? runtime.binary.trim() : id;
      const result = await ensureConnectorReauthFromRuntime({
        errorText,
        runtime,
        parentWindow: ctx.mainWindow,
        connectorId: id,
        onAuthenticated: async () => {
          await service.markManagedCliConnectedAfterAuth(binary);
        },
      });
      sendJson(res, 200, {
        success: result.authenticated,
        data: result,
        errMessage: result.authenticated ? undefined : '重新登录未完成',
      });
      return true;
    }

    if (url.pathname === '/api/connectors/qpath/reauth' && req.method === 'POST') {
      const { ensureQpathReauthIfNeeded } = await import('../../utils/qpath-reauth');
      const result = await ensureQpathReauthIfNeeded(
        '未登录，请先运行 qpath login',
        ctx.mainWindow,
      );
      sendJson(res, 200, {
        success: result.authenticated,
        data: result,
        errMessage: result.authenticated ? undefined : 'QPath 重新登录未完成',
      });
      return true;
    }
  } catch (error) {
    logger.error('[connectors] request failed:', error);
    const { status, body } = errorPayload(error);
    sendJson(res, status, body);
    return true;
  }

  return false;
}
