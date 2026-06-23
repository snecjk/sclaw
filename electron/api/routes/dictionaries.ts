import type { IncomingMessage, ServerResponse } from 'http';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { getStoToken } from '../../utils/auth-store';
import { logger } from '../../utils/logger';
import type { HostApiContext } from '../context';

async function extractDictionaryHeaders(req: IncomingMessage): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Source-Client': 'stoclaw',
  };
  const headerToken = req.headers.stotoken;
  const stoToken = headerToken ? String(headerToken) : await getStoToken();
  if (stoToken) {
    headers.stoToken = stoToken;
  }
  const traceId = req.headers['x-trace-id'];
  if (traceId) {
    headers['X-Trace-Id'] = String(traceId);
  }
  return headers;
}

/** GET /api/v1/dictionaries/types/:typeCode/items — MC dictionaryApi parity */
export async function handleDictionaryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/v1\/dictionaries\/types\/([^/]+)\/items$/);
  if (!match || req.method !== 'GET') {
    return false;
  }

  const typeCode = decodeURIComponent(match[1]);
  const tenantId = url.searchParams.get('tenantId') ?? '0';
  const backendPath =
    `/api/v1/dictionaries/types/${encodeURIComponent(typeCode)}/items?tenantId=${encodeURIComponent(tenantId)}`;

  try {
    const baseUrl = await resolveStoBaseUrl();
    const headers = await extractDictionaryHeaders(req);
    const response = await proxyAwareFetch(`${baseUrl}${backendPath}`, {
      method: 'GET',
      headers,
      timeoutMs: 30_000,
    });

    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
    const responseBody = await response.text();

    res.statusCode = response.status;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    const responseTraceId = response.headers.get('x-trace-id');
    if (responseTraceId) {
      res.setHeader('X-Trace-Id', responseTraceId);
    }
    res.end(responseBody);
  } catch (error) {
    logger.error('[DictionaryRoutes] fetch items failed typeCode=%s:', typeCode, error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: false, error: String(error) }));
  }

  return true;
}
