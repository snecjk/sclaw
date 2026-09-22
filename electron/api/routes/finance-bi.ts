import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  financeBiFetchJson,
  getFinanceBiPreviewBridgePreloadUrl,
  getFinanceBiPreviewEmbedAuth,
  getLastFinanceBiExchangeDebug,
  getLastFinanceBiListCallDebug,
} from '../../services/finance-bi-auth-service';
import { logger } from '../../utils/logger';

function errorStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const code = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isFinite(code) && code >= 400 && code < 600) return code;
  }
  return 500;
}

export async function handleFinanceBiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/finance-bi/')) {
    return false;
  }

  try {
    if (url.pathname === '/api/finance-bi/model-menu/list' && req.method === 'POST') {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const data = await financeBiFetchJson('/bi/modelMenu/list', { method: 'POST', body });
      sendJson(res, 200, {
        success: true,
        data,
        exchangeDebug: getLastFinanceBiExchangeDebug(),
        listCallDebug: getLastFinanceBiListCallDebug(),
      });
      return true;
    }

    if (url.pathname === '/api/finance-bi/model-menu/access/apply' && req.method === 'POST') {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const data = await financeBiFetchJson('/bi/modelMenu/access/apply', { method: 'POST', body });
      sendJson(res, 200, {
        success: true,
        data,
        exchangeDebug: getLastFinanceBiExchangeDebug(),
      });
      return true;
    }

    if (url.pathname === '/api/finance-bi/product/model-options' && req.method === 'POST') {
      const data = await financeBiFetchJson('/bi/dataModel/product/modelOptions', {
        method: 'POST',
        body: {},
      });
      sendJson(res, 200, { success: true, data });
      return true;
    }

    if (url.pathname === '/api/finance-bi/product/list' && req.method === 'POST') {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const data = await financeBiFetchJson('/bi/dataModel/product/list', { method: 'POST', body });
      sendJson(res, 200, { success: true, data });
      return true;
    }

    if (url.pathname === '/api/finance-bi/product/record/query' && req.method === 'POST') {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const data = await financeBiFetchJson('/bi/dataModel/product/record/query', {
        method: 'POST',
        body,
      });
      sendJson(res, 200, { success: true, data });
      return true;
    }

    if (url.pathname === '/api/finance-bi/product/export' && req.method === 'POST') {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const data = await financeBiFetchJson('/bi/dataModel/product/export', {
        method: 'POST',
        body,
      });
      sendJson(res, 200, { success: true, data });
      return true;
    }

    if (url.pathname === '/api/finance-bi/product/export/record/list' && req.method === 'POST') {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const data = await financeBiFetchJson('/bi/dataModel/product/export/record/list', {
        method: 'POST',
        body,
      });
      sendJson(res, 200, { success: true, data });
      return true;
    }

    if (url.pathname === '/api/finance-bi/preview-embed-auth' && req.method === 'POST') {
      const data = await getFinanceBiPreviewEmbedAuth();
      sendJson(res, 200, { success: true, data });
      return true;
    }

    if (url.pathname === '/api/finance-bi/preview-embed-bridge' && req.method === 'POST') {
      sendJson(res, 200, { success: true, data: { preloadUrl: getFinanceBiPreviewBridgePreloadUrl() } });
      return true;
    }

    // 数据管理页：对齐 preview POST /bi/datasourceSon/list
    if (url.pathname === '/api/finance-bi/datasource-son/list' && req.method === 'POST') {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const data = await financeBiFetchJson('/bi/datasourceSon/list', { method: 'POST', body });
      sendJson(res, 200, { success: true, data });
      return true;
    }

    // 对齐 preview POST /bi/datasourceSon/delete/:code
    if (url.pathname === '/api/finance-bi/datasource-son/delete' && req.method === 'POST') {
      const body = await parseJsonBody<{ code?: string }>(req);
      const code = String(body.code || '').trim();
      if (!code) {
        sendJson(res, 200, { success: false, error: '缺少数据源编码', data: null });
        return true;
      }
      const data = await financeBiFetchJson(
        `/bi/datasourceSon/delete/${encodeURIComponent(code)}`,
        { method: 'POST', body: {} },
      );
      sendJson(res, 200, { success: true, data });
      return true;
    }
  } catch (error) {
    logger.error('[finance-bi] request failed:', error);
    // 始终 HTTP 200 + success:false，便于渲染进程拿到 debug（hostApiFetch 对 4xx 会丢 body）
    sendJson(res, 200, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: null,
      exchangeDebug: getLastFinanceBiExchangeDebug(),
      listCallDebug: getLastFinanceBiListCallDebug(),
      upstreamStatus: errorStatus(error),
    });
    return true;
  }

  sendJson(res, 404, { success: false, error: `No finance-bi route for ${req.method} ${url.pathname}` });
  return true;
}
