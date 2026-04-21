import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getStoSubscriptionService } from '../../services/sto-subscription-service';
import { logger } from '../../utils/logger';

export async function handleSubscriptionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  // GET /api/subscriptions/features
  if (url.pathname === '/api/subscriptions/features' && req.method === 'GET') {
    try {
      const service = getStoSubscriptionService();
      const result = await service.listFeatures();
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('[subscriptions] listFeatures error:', error);
      const statusCode = /未登录|stoToken|unauthori[sz]ed/i.test(String(error)) ? 401 : 500;
      sendJson(res, statusCode, { success: false, error: String(error) });
    }
    return true;
  }

  // POST /api/subscriptions/subscribe
  if (url.pathname === '/api/subscriptions/subscribe' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ featureId: string }>(req);
      const service = getStoSubscriptionService();
      const result = await service.subscribe(body.featureId);
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('[subscriptions] subscribe error:', error);
      const statusCode = /未登录|stoToken|unauthori[sz]ed/i.test(String(error)) ? 401 : 500;
      sendJson(res, statusCode, { success: false, error: String(error) });
    }
    return true;
  }

  // POST /api/subscriptions/unsubscribe
  if (url.pathname === '/api/subscriptions/unsubscribe' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ featureId: string }>(req);
      const service = getStoSubscriptionService();
      const result = await service.unsubscribe(body.featureId);
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('[subscriptions] unsubscribe error:', error);
      const statusCode = /未登录|stoToken|unauthori[sz]ed/i.test(String(error)) ? 401 : 500;
      sendJson(res, statusCode, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
