import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getAppPlazaService } from '../../services/app-plaza-service';
import { StoMemoryApiError } from '../../services/sto-memory-api-fetch';
import { logger } from '../../utils/logger';

function errorStatus(error: unknown): number {
  return error instanceof StoMemoryApiError ? error.statusCode : 500;
}

export async function handleAppPlazaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  const service = getAppPlazaService();

  try {
    if (url.pathname === '/api/app-plaza/apps' && req.method === 'GET') {
      const result = await service.listApps({
        pageNum: Number(url.searchParams.get('pageNum') || 1),
        pageSize: Number(url.searchParams.get('pageSize') || 20),
        keyword: url.searchParams.get('keyword') || undefined,
        categoryCode: url.searchParams.get('categoryCode') || undefined,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === '/api/app-plaza/categories' && req.method === 'GET') {
      sendJson(res, 200, await service.listCategories());
      return true;
    }

    if (url.pathname === '/api/app-plaza/banners' && req.method === 'GET') {
      sendJson(res, 200, await service.listBanners());
      return true;
    }
  } catch (error) {
    logger.error('[app-plaza] request failed:', error);
    sendJson(res, errorStatus(error), {
      success: false,
      errCode: String(errorStatus(error)),
      errMessage: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error),
      data: null,
    });
    return true;
  }

  return false;
}
