import type { IncomingMessage, ServerResponse } from 'http';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { getStoToken } from '../../utils/auth-store';
import { logger } from '../../utils/logger';
import type { HostApiContext } from '../context';
import { parseJsonBody } from '../route-utils';

async function proxyWorkflowStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backendPath: string,
): Promise<void> {
  logger.info('[workflow-trace] SSE proxy start %s', backendPath);
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
      timeoutMs: 0, // No timeout for SSE streams
    });

    if (!response.ok) {
      logger.warn('[workflow-trace] SSE proxy backend error %s status=%s', backendPath, response.status);
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: `Backend returned ${response.status}` }));
      return;
    }

    logger.info('[workflow-trace] SSE proxy connected %s status=%s', backendPath, response.status);
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

    let chunkCount = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount += 1;
      if (chunkCount === 1 || chunkCount % 10 === 0) {
        logger.info('[workflow-trace] SSE proxy chunk #%d %s bytes=%d', chunkCount, backendPath, value?.length ?? 0);
      }
      res.write(decoder.decode(value, { stream: true }));
    }

    logger.info('[workflow-trace] SSE proxy end %s chunks=%d', backendPath, chunkCount);
    res.end();
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes('AbortError') || errStr.includes('aborted')) {
      logger.info('[workflow-trace] SSE proxy aborted %s', backendPath);
      return;
    }
    logger.error('[workflow-trace] SSE proxy failed %s:', backendPath, err);
    logger.error('[WorkflowRoutes] Stream proxy failed:', err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(err) }));
    }
  }
}

const RUN_TRACE_JSON_MAX = 8_000;

function truncateForRunTrace(text: string): string {
  if (text.length <= RUN_TRACE_JSON_MAX) return text;
  return `${text.slice(0, RUN_TRACE_JSON_MAX)}…(truncated ${text.length - RUN_TRACE_JSON_MAX} chars)`;
}

async function extractWorkflowHeaders(req: IncomingMessage): Promise<Record<string, string>> {
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

function logWorkflowApiRequest(method: string, path: string, body?: string): void {
  logger.info(
    `[workflow-api] >>> ${method} ${path} body=${truncateForRunTrace(body ?? '(none)')}`,
  );
}

function logWorkflowApiResponse(method: string, path: string, status: number, responseBody: string): void {
  logger.info(
    `[workflow-api] <<< ${method} ${path} status=${status} response=${truncateForRunTrace(responseBody)}`,
  );
}

async function proxyWorkflowRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backendPath: string,
  body?: unknown,
): Promise<void> {
  const baseUrl = await resolveStoBaseUrl();
  const headers = await extractWorkflowHeaders(req);
  const method = (req.method || 'GET').toUpperCase();

  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  }

  logWorkflowApiRequest(method, backendPath, bodyStr);

  const response = await proxyAwareFetch(`${baseUrl}${backendPath}`, {
    method,
    headers,
    body: bodyStr,
    timeoutMs: 30_000,
  });

  // Forward status code, content-type and body as-is
  const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
  const responseBody = await response.text();

  logWorkflowApiResponse(method, backendPath, response.status, responseBody);

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

  // 1. POST /agent/v1/workflow-templates
  if (pathname === '/agent/v1/workflow-templates' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ query?: string; page?: number; pageSize?: number }>(req);
      const backendPath = '/agent/v1/workflow-templates';
      const bodyStr = JSON.stringify(body);
      logWorkflowApiRequest('POST', backendPath, bodyStr);

      const baseUrl = await resolveStoBaseUrl();
      const headers = await extractWorkflowHeaders(req);

      const response = await proxyAwareFetch(`${baseUrl}${backendPath}`, {
        method: 'POST',
        headers,
        body: bodyStr,
        timeoutMs: 30_000,
      });

      const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
      const responseBody = await response.text();

      logWorkflowApiResponse('POST', backendPath, response.status, responseBody);

      res.statusCode = response.status;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', contentType);
      const responseTraceId = response.headers.get('x-trace-id');
      if (responseTraceId) {
        res.setHeader('X-Trace-Id', responseTraceId);
      }
      res.end(responseBody);
    } catch (error) {
      logger.error('[WorkflowRoutes] list templates failed:', error);
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
      logger.info(
        '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema (proxy)',
        startupSchemaMatch[1],
      );
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
      logger.info(
        '[workflow-trace] POST /agent/v1/workflows templateId=%s idempotencyKey=%s',
        body.templateId,
        body.idempotencyKey,
      );
      await proxyWorkflowRequest(req, res, '/agent/v1/workflows', body);
    } catch (error) {
      logger.error('[WorkflowRoutes] create workflow failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 4. GET /agent/v1/workflows/:workflowId
  const workflowDetailMatch = pathname.match(/^\/agent\/v1\/workflows\/([^/]+)$/);
  if (workflowDetailMatch && req.method === 'GET') {
    try {
      logger.info('[workflow-trace] GET %s (proxy) workflowId=%s', pathname, workflowDetailMatch[1]);
      await proxyWorkflowRequest(req, res, pathname);
    } catch (error) {
      logger.error('[WorkflowRoutes] get workflow detail failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 5. POST /agent/v1/workflows/:workflowId/start
  const startMatch = pathname.match(/^\/agent\/v1\/workflows\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      logger.info(
        '[workflow-trace] POST %s idempotencyKey=%s inputKeys=%o',
        pathname,
        body.idempotencyKey,
        Object.keys((body.inputs as Record<string, unknown> | undefined) ?? {}),
      );
      await proxyWorkflowRequest(req, res, pathname, body);
    } catch (error) {
      logger.error('[WorkflowRoutes] start workflow failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 6. GET /agent/v1/runs/:runId/stream (SSE)
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
