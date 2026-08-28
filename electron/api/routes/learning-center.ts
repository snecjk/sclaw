import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  forwardLearningCenterRequest,
  LEARNING_CENTER_CLIENT_ROUTES,
} from '../../services/learning-center-service';
import { StoMemoryApiError } from '../../services/sto-memory-api-fetch';
import { logger } from '../../utils/logger';

const ROUTE_PREFIX = '/api/learning-center/';

function statusOf(error: unknown) {
  return error instanceof StoMemoryApiError ? error.statusCode : 500;
}

/**
 * Proxy the seven learning center client routes to memory-center.
 *
 * Upstream failures are re-enveloped as HTTP 200 `{ success: false, errCode }`
 * responses: the renderer's `hostApiFetch` throws on non-2xx before the
 * learning-center adapter can inspect the envelope, and the adapter needs
 * `errCode` (e.g. `403`) to distinguish forbidden content from generic errors.
 */
export async function handleLearningCenterRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (req.method !== 'POST' || !url.pathname.startsWith(ROUTE_PREFIX)) return false;
  const route = url.pathname.slice(ROUTE_PREFIX.length);
  if (!LEARNING_CENTER_CLIENT_ROUTES.has(route)) return false;

  try {
    const body = await parseJsonBody<{ data?: unknown }>(req);
    const data = body?.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      sendJson(res, 200, { success: false, errCode: '400', errMessage: '学习中心请求参数无效', data: null });
      return true;
    }
    sendJson(res, 200, await forwardLearningCenterRequest(route, data as Record<string, unknown>));
  } catch (error) {
    logger.error(`[learning-center] ${route} request failed:`, error);
    const status = statusOf(error);
    sendJson(res, 200, {
      success: false,
      errCode: String(status),
      errMessage: error instanceof Error ? error.message : '学习中心请求失败',
      data: null,
    });
  }
  return true;
}
