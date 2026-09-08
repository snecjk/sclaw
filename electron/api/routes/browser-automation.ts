import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson, sendNoContent } from '../route-utils';
import { browserAutomationService } from '../../services/browser-automation/service';
import { readBaArtifact } from '../../services/browser-automation/artifact-writer';
import { isBrowserAutomationEnabled } from '../../../shared/browser-automation/feature-flag';
import { checkBrowserAutomationHttpAuth } from '../browser-automation-auth';
import type {
  BrowserAutomationActPayload,
  BrowserAutomationFindQuery,
  BrowserAutomationNetworkCaptureOptions,
  BrowserAutomationObserveOptions,
  BrowserAutomationPrintPdfOptions,
  BrowserAutomationReadPageOptions,
  BrowserAutomationScreenshotOptions,
  BrowserAutomationValidatorSpec,
  BrowserAutomationWaitCondition,
} from '../../../shared/browser-automation/types';

/** read-page 端点 body 上限（C1/C2：长文分页参数走 body，显式 8MB 闸）。 */
const READ_PAGE_BODY_MAX_BYTES = 8 * 1024 * 1024;

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

  // P0-3 鉴权（Host 白名单 + Bearer token；token 未配置时灰度放行，详见 browser-automation-auth.ts）
  const authFailure = checkBrowserAutomationHttpAuth(req);
  if (authFailure) {
    sendJson(res, authFailure.statusCode, {
      success: false,
      error: { code: authFailure.code, message: authFailure.message },
    });
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
    const body = await parseJsonBody<{
      sessionId?: string;
      mode?: BrowserAutomationObserveOptions['mode'];
      interactiveOnly?: boolean;
      ref?: string;
    }>(req);
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const observation = await browserAutomationService.observe(body.sessionId, {
      mode: body.mode,
      interactiveOnly: body.interactiveOnly,
      ref: body.ref,
    });
    sendJson(res, 200, { success: true, observation });
    return true;
  }

  if (url.pathname === '/api/browser-automation/find' && req.method === 'POST') {
    const body = await parseJsonBody<{ sessionId?: string; query?: BrowserAutomationFindQuery }>(req);
    if (!body.sessionId || !body.query) {
      sendJson(res, 400, { success: false, error: 'sessionId and query are required' });
      return true;
    }
    const result = await browserAutomationService.find(body.sessionId, body.query);
    sendJson(res, 200, { success: true, result });
    return true;
  }

  if (url.pathname === '/api/browser-automation/read-page' && req.method === 'POST') {
    let body: { sessionId?: string; opts?: BrowserAutomationReadPageOptions };
    try {
      body = await parseJsonBody<{ sessionId?: string; opts?: BrowserAutomationReadPageOptions }>(req, {
        maxBytes: READ_PAGE_BODY_MAX_BYTES,
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number } | null)?.statusCode;
      if (statusCode === 413) {
        sendJson(res, 413, {
          success: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'request body too large' },
        });
        return true;
      }
      throw error;
    }
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const result = await browserAutomationService.readPage(body.sessionId, body.opts);
    sendJson(res, 200, { success: true, result });
    return true;
  }

  if (url.pathname === '/api/browser-automation/print-pdf' && req.method === 'POST') {
    const body = await parseJsonBody<{ sessionId?: string; opts?: BrowserAutomationPrintPdfOptions }>(req);
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const artifact = await browserAutomationService.printToPdf(body.sessionId, body.opts);
    sendJson(res, 200, { success: true, artifact });
    return true;
  }

  if (url.pathname === '/api/browser-automation/network/capture' && req.method === 'POST') {
    const body = await parseJsonBody<{
      sessionId?: string;
      captureId?: string;
      op?: 'start' | 'stop';
      opts?: BrowserAutomationNetworkCaptureOptions;
    }>(req, { maxBytes: READ_PAGE_BODY_MAX_BYTES });
    if (!body.sessionId || (body.op !== 'start' && body.op !== 'stop')) {
      sendJson(res, 400, { success: false, error: 'sessionId and op (start|stop) are required' });
      return true;
    }
    if (body.op === 'start') {
      const result = await browserAutomationService.startNetworkCapture(body.sessionId, body.opts);
      sendJson(res, 200, { success: true, result });
      return true;
    }
    const result = await browserAutomationService.stopNetworkCapture(body.sessionId, body.captureId);
    sendJson(res, 200, { success: true, result });
    return true;
  }

  if (url.pathname === '/api/browser-automation/cdp' && req.method === 'POST') {
    const body = await parseJsonBody<{
      sessionId?: string;
      method?: string;
      params?: Record<string, unknown>;
    }>(req);
    if (!body.sessionId || !body.method) {
      sendJson(res, 400, { success: false, error: 'sessionId and method are required' });
      return true;
    }
    try {
      const result = await browserAutomationService.invokeCdp(body.sessionId, body.method, body.params);
      sendJson(res, 200, { success: true, result });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      sendJson(res, 200, {
        success: false,
        error: {
          code: code ?? 'CDP_TIMEOUT',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
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

  const dialogsMatch = /^\/api\/browser-automation\/sessions\/([^/]+)\/dialogs$/.exec(url.pathname);
  if (dialogsMatch && req.method === 'GET') {
    const sessionId = decodeURIComponent(dialogsMatch[1]);
    try {
      const dialogs = await browserAutomationService.drainDialogs(sessionId);
      sendJson(res, 200, { success: true, dialogs });
    } catch (error) {
      sendJson(res, 404, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    const body = await parseJsonBody<{
      sessionId?: string;
      ref?: BrowserAutomationScreenshotOptions['ref'];
      format?: BrowserAutomationScreenshotOptions['format'];
      quality?: number;
    }>(req);
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const artifact = await browserAutomationService.captureScreenshot(body.sessionId, {
      ref: body.ref,
      format: body.format,
      quality: body.quality,
    });
    sendJson(res, 200, { success: true, artifact });
    return true;
  }

  const artifactMatch = /^\/api\/browser-automation\/artifacts\/([^/]+)$/.exec(url.pathname);
  if (artifactMatch && req.method === 'GET') {
    try {
      const { ref, bytes } = await readBaArtifact(decodeURIComponent(artifactMatch[1]));
      res.statusCode = 200;
      res.setHeader('Content-Type', ref.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', String(bytes.byteLength));
      res.end(bytes);
    } catch (error) {
      sendJson(res, 404, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  return false;
}
