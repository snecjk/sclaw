/**
 * STO Model Sync API Routes
 * Exposes STO model synchronisation to the renderer via Host API.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getStoModelSyncService } from '../../services/providers/sto-model-sync';
import { logger } from '../../utils/logger';

export async function handleStoSyncRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  // POST /api/sto-model-sync — trigger a full sync cycle
  if (url.pathname === '/api/sto-model-sync' && req.method === 'POST') {
    try {
      const service = getStoModelSyncService();

      // Ensure the service has access to the gateway manager from context
      if (ctx.gatewayManager) {
        service.setGatewayManager(ctx.gatewayManager);
      }

      const result = await service.syncModels();
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      logger.error('[sto-sync] Sync route error:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
