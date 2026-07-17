import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  migrateMoreAppsRegistry,
  readMoreAppsRegistry,
  writeMoreAppsRegistry,
  type MoreAppsRegistry,
} from '../../services/more-apps-store';

export async function handleMoreAppsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/more-apps' && req.method === 'GET') {
    try {
      sendJson(res, 200, readMoreAppsRegistry());
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/more-apps' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<MoreAppsRegistry>(req);
      const saved = writeMoreAppsRegistry(body);
      sendJson(res, 200, { success: true, registry: saved });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/more-apps/migrate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<unknown>(req);
      const result = migrateMoreAppsRegistry(body);
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
