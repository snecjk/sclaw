import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getStoTokenQuotaService } from '../../services/sto-token-quota-service';
import { logger } from '../../utils/logger';

export async function handleTokenQuotaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/token-quota/check' && req.method === 'GET') {
    try {
      const service = getStoTokenQuotaService();
      const result = await service.checkTokenQuota();
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('[token-quota] Check route error:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
