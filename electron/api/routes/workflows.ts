import type { IncomingMessage, ServerResponse } from 'http';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { logger } from '../../utils/logger';
import type { HostApiContext } from '../context';
import { parseJsonBody } from '../route-utils';

async function proxyWorkflowStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backendPath: string,
): Promise<void> {
  const baseUrl = await resolveStoBaseUrl();
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
  };
  const stoToken = req.headers.stotoken;
  if (stoToken) {
    headers.stoToken = String(stoToken);
  }
  const traceId = req.headers['x-trace-id'];
  if (traceId) {
    headers['X-Trace-Id'] = String(traceId);
  }

  const controller = new AbortController();
  // Clean up controller when client disconnects
  res.on('close', () => controller.abort());

  try {
    const response = await proxyAwareFetch(`${baseUrl}${backendPath}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
      timeoutMs: Infinity, // No timeout for SSE streams
    });

    if (!response.ok) {
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: `Backend returned ${response.status}` }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const responseTraceId = response.headers.get('x-trace-id');
    if (responseTraceId) {
      res.setHeader('X-Trace-Id', responseTraceId);
    }

    // Pipe ReadableStream to ServerResponse
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes('AbortError') || errStr.includes('aborted')) {
      // Client disconnected, no error needed
      return;
    }
    logger.error('[WorkflowRoutes] Stream proxy failed:', err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(err) }));
    }
  }
}

function extractWorkflowHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const stoToken = req.headers.stotoken;
  if (stoToken) {
    headers.stoToken = String(stoToken);
  }
  const traceId = req.headers['x-trace-id'];
  if (traceId) {
    headers['X-Trace-Id'] = String(traceId);
  }
  return headers;
}

async function proxyWorkflowRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backendPath: string,
  body?: unknown,
): Promise<void> {
  const baseUrl = await resolveStoBaseUrl();
  const headers = extractWorkflowHeaders(req);

  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await proxyAwareFetch(`${baseUrl}${backendPath}`, {
    method: req.method || 'GET',
    headers,
    body: bodyStr,
    timeoutMs: 30_000,
  });

  // Forward status code, content-type and body as-is
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
}

export async function handleWorkflowRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  const pathname = url.pathname;
  logger.info(`[WorkflowRoutes] checking ${req.method} ${pathname}`);

  // 1. POST /agent/v1/workflow-templates/search
  if (pathname === '/agent/v1/workflow-templates/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ query: string; limit?: number }>(req);
      logger.info('[WorkflowRoutes] search request body:', JSON.stringify(body));

      // Capture response for logging
      const baseUrl = await resolveStoBaseUrl();
      const headers = extractWorkflowHeaders(req);
      const bodyStr = JSON.stringify(body);

      const response = await proxyAwareFetch(`${baseUrl}/agent/v1/workflow-templates/search`, {
        method: 'POST',
        headers,
        body: bodyStr,
        timeoutMs: 30_000,
      });

      const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
      const responseBody = await response.text();

      logger.info('[WorkflowRoutes] search response status:', response.status);
      logger.info('[WorkflowRoutes] search response body:', responseBody);

      res.statusCode = response.status;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', contentType);
      const responseTraceId = response.headers.get('x-trace-id');
      if (responseTraceId) {
        res.setHeader('X-Trace-Id', responseTraceId);
      }
      res.end(responseBody);
    } catch (error) {
      logger.error('[WorkflowRoutes] search failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 2. GET /agent/v1/workflow-templates/:templateId/startup-schema
  const startupSchemaMatch = pathname.match(/^\/agent\/v1\/workflow-templates\/([^/]+)\/startup-schema$/);
  if (startupSchemaMatch && req.method === 'GET') {
    try {
      await proxyWorkflowRequest(req, res, pathname);
    } catch (error) {
      logger.error('[WorkflowRoutes] startup-schema failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 3. POST /agent/v1/workflows
  if (pathname === '/agent/v1/workflows' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await proxyWorkflowRequest(req, res, '/agent/v1/workflows', body);
    } catch (error) {
      logger.error('[WorkflowRoutes] create workflow failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 4. POST /agent/v1/workflows/:workflowId/start
  const startMatch = pathname.match(/^\/agent\/v1\/workflows\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await proxyWorkflowRequest(req, res, pathname, body);
    } catch (error) {
      logger.error('[WorkflowRoutes] start workflow failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 5. GET /agent/v1/runs/:runId/stream (SSE)
  const runStreamMatch = pathname.match(/^\/agent\/v1\/runs\/([^/]+)\/stream$/);
  if (runStreamMatch && req.method === 'GET') {
    // SSE stream: no try/catch wrapper — proxyWorkflowStreamRequest handles its own errors
    void proxyWorkflowStreamRequest(req, res, pathname);
    return true;
  }

  // 6. GET /agent/v1/runs/:runId
  const runMatch = pathname.match(/^\/agent\/v1\/runs\/([^/]+)$/);
  if (runMatch && req.method === 'GET') {
    try {
      await proxyWorkflowRequest(req, res, pathname);
    } catch (error) {
      logger.error('[WorkflowRoutes] get run failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  return false;
}
