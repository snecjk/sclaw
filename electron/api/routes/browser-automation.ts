import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson, sendNoContent } from '../route-utils';
import { browserAutomationService } from '../../services/browser-automation/service';
import { isBrowserAutomationEnabled } from '../../../shared/browser-automation/feature-flag';
import type {
  BrowserAutomationActPayload,
  BrowserAutomationValidatorSpec,
  BrowserAutomationWaitCondition,
} from '../../../shared/browser-automation/types';

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function featureDisabled(res: ServerResponse): void {
  sendJson(res, 503, { success: false, error: 'Browser automation is disabled' });
}

export async function handleBrowserAutomationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/browser-automation')) {
    return false;
  }

  if (!isBrowserAutomationEnabled()) {
    if (req.method === 'OPTIONS') {
      sendNoContent(res);
      return true;
    }
    featureDisabled(res);
    return true;
  }

  if (!isLoopback(req)) {
    sendJson(res, 403, { success: false, error: 'Browser automation API is localhost-only' });
    return true;
  }

  if (url.pathname === '/api/browser-automation/sessions' && req.method === 'GET') {
    sendJson(res, 200, { success: true, sessions: browserAutomationService.listSessions() });
    return true;
  }

  if (url.pathname === '/api/browser-automation/sessions' && req.method === 'POST') {
    const body = await parseJsonBody<{
      embedRuntimeId?: string;
      url?: string;
      showManaged?: boolean;
    }>(req);
    const session = await browserAutomationService.createSession(body);
    sendJson(res, 200, { success: true, session });
    return true;
  }

  if (url.pathname === '/api/browser-automation/observe' && req.method === 'POST') {
    const body = await parseJsonBody<{ sessionId?: string }>(req);
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const observation = await browserAutomationService.observe(body.sessionId);
    sendJson(res, 200, { success: true, observation });
    return true;
  }

  if (url.pathname === '/api/browser-automation/act' && req.method === 'POST') {
    const body = await parseJsonBody<{
      sessionId?: string;
      runId?: string;
      payload?: BrowserAutomationActPayload;
    }>(req);
    if (!body.sessionId || !body.payload?.action) {
      sendJson(res, 400, { success: false, error: 'sessionId and payload.action are required' });
      return true;
    }
    const result = await browserAutomationService.act(body.sessionId, body.payload, body.runId);
    sendJson(res, 200, { success: true, result });
    return true;
  }

  if (url.pathname === '/api/browser-automation/wait' && req.method === 'POST') {
    const body = await parseJsonBody<{
      sessionId?: string;
      condition?: BrowserAutomationWaitCondition;
    }>(req);
    if (!body.sessionId || !body.condition?.type) {
      sendJson(res, 400, { success: false, error: 'sessionId and condition.type are required' });
      return true;
    }
    const result = await browserAutomationService.wait(body.sessionId, body.condition);
    sendJson(res, 200, { success: true, ...result });
    return true;
  }

  if (url.pathname === '/api/browser-automation/validate' && req.method === 'POST') {
    const body = await parseJsonBody<{
      sessionId?: string;
      runId?: string;
      spec?: BrowserAutomationValidatorSpec;
    }>(req);
    if (!body.sessionId || !body.spec?.type) {
      sendJson(res, 400, { success: false, error: 'sessionId and spec.type are required' });
      return true;
    }
    const result = await browserAutomationService.validate(body.sessionId, body.spec, body.runId);
    sendJson(res, 200, { success: true, result });
    return true;
  }

  if (url.pathname === '/api/browser-automation/runs' && req.method === 'POST') {
    const body = await parseJsonBody<{ sessionId?: string; runId?: string; workflowRunId?: string }>(req);
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const runId = await browserAutomationService.startRun(body.sessionId, {
      runId: body.runId,
      workflowRunId: body.workflowRunId ?? null,
    });
    sendJson(res, 200, { success: true, runId });
    return true;
  }

  if (url.pathname === '/api/browser-automation/runs/complete' && req.method === 'POST') {
    const body = await parseJsonBody<{ runId?: string; status?: string }>(req);
    if (!body.runId) {
      sendJson(res, 400, { success: false, error: 'runId is required' });
      return true;
    }
    await browserAutomationService.completeRun(body.runId, (body.status as 'SUCCEEDED') ?? 'SUCCEEDED');
    sendJson(res, 200, { success: true });
    return true;
  }

  if (url.pathname === '/api/browser-automation/screenshot' && req.method === 'POST') {
    const body = await parseJsonBody<{ sessionId?: string }>(req);
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const png = await browserAutomationService.captureScreenshot(body.sessionId);
    sendJson(res, 200, { success: true, mimeType: 'image/png', base64: png.toString('base64') });
    return true;
  }

  return false;
}
