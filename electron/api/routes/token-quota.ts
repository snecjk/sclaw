import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getStoTokenQuotaService } from '../../services/sto-token-quota-service';
import { logger } from '../../utils/logger';

function resolveTokenQuotaStatusCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
      return statusCode;
    }
  }

  const message = String(error);
  if (/未登录|stoToken|unauthori[sz]ed/i.test(message)) {
    return 401;
  }
  if (/forbidden|403/i.test(message)) {
    return 403;
  }
  return 500;
}

export async function handleTokenQuotaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/token-quota/check' && req.method === 'GET') {
    // In development mode, bypass the remote quota check so local testing
    // isn't blocked by backend token limits.
    const isDev = (import.meta.env.VITE_APP_ENV as string) === 'development';
    if (isDev) {
      sendJson(res, 200, { success: true, data: { allowed: true } });
      return true;
    }

    try {
      const service = getStoTokenQuotaService();
      const result = await service.checkTokenQuota();
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('[token-quota] Check route error:', error);
      const statusCode = resolveTokenQuotaStatusCode(error);
      sendJson(res, statusCode, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
