import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleSclawBrowserRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  const captureMatch = url.pathname.match(/^\/api\/sclaw-browser\/runtime\/([^/]+)\/capture$/);
  if (req.method === 'POST' && captureMatch) {
    const runtimeId = decodeURIComponent(captureMatch[1]);
    const { captureSclawEmbedBrowserPage } = await import('../../main/services/sclaw-embed-browser-runtime');
    const snapshot = await captureSclawEmbedBrowserPage(runtimeId);
    sendJson(res, 200, { success: true, snapshot });
    return true;
  }

  const executeMatch = url.pathname.match(/^\/api\/sclaw-browser\/runtime\/([^/]+)\/execute$/);
  if (req.method === 'POST' && executeMatch) {
    const runtimeId = decodeURIComponent(executeMatch[1]);
    const body = await parseJsonBody<{ script?: string }>(req);
    const script = typeof body?.script === 'string' ? body.script : '';
    if (!script) {
      sendJson(res, 400, { success: false, error: 'script is required' });
      return true;
    }
    const { executeSclawEmbedBrowserScript } = await import('../../main/services/sclaw-embed-browser-runtime');
    const value = await executeSclawEmbedBrowserScript(runtimeId, script);
    sendJson(res, 200, { success: true, value });
    return true;
  }

  const networkMatch = url.pathname.match(/^\/api\/sclaw-browser\/runtime\/([^/]+)\/network-log$/);
  if (req.method === 'GET' && networkMatch) {
    const runtimeId = decodeURIComponent(networkMatch[1]);
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const { getSclawEmbedBrowserNetworkLog } = await import('../../main/services/sclaw-embed-browser-runtime');
    const events = getSclawEmbedBrowserNetworkLog(runtimeId, Number.isFinite(since) ? since : undefined);
    sendJson(res, 200, { success: true, events });
    return true;
  }

  const metaMatch = url.pathname.match(/^\/api\/sclaw-browser\/runtime\/([^/]+)$/);
  if (req.method === 'GET' && metaMatch) {
    const runtimeId = decodeURIComponent(metaMatch[1]);
    const { getSclawEmbedBrowserRuntime } = await import('../../main/services/sclaw-embed-browser-runtime');
    const meta = getSclawEmbedBrowserRuntime(runtimeId);
    if (!meta) {
      sendJson(res, 404, { success: false, error: 'runtime not found' });
      return true;
    }
    sendJson(res, 200, { success: true, meta });
    return true;
  }

  const bySessionMatch = url.pathname.match(/^\/api\/sclaw-browser\/by-session\/(.+)$/);
  if (req.method === 'GET' && bySessionMatch) {
    const chatSessionKey = decodeURIComponent(bySessionMatch[1]);
    const { resolveSclawEmbedBrowserRuntimeByChatSession } = await import('../../main/services/sclaw-embed-browser-runtime');
    const meta = resolveSclawEmbedBrowserRuntimeByChatSession(chatSessionKey);
    if (!meta) {
      sendJson(res, 404, { success: false, error: 'runtime not found for session' });
      return true;
    }
    sendJson(res, 200, { success: true, meta });
    return true;
  }

  return false;
}
