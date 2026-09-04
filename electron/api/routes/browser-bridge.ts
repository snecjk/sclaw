import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { HostApiContext } from '../context';
import { browserBridgeService } from '../../services/browser-bridge-service';
import { parseJsonBody, sendJson, sendNoContent } from '../route-utils';
import type { BrowserBridgeAction } from '../../../shared/browser-bridge/types';
import { isCdpMethodAllowed } from '../../../shared/browser-automation/cdp-allowlist';
import {
  getBundledBrowserBridgeExtensionVersion,
  resolveBrowserBridgeExtensionZipPath,
} from '../../utils/browser-bridge-extension';

function setBridgeCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('http://localhost')
  )) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function readToken(req: IncomingMessage): string | undefined {
  const header = req.headers['x-session-token'];
  return typeof header === 'string' ? header : undefined;
}

function requireExtensionToken(req: IncomingMessage, res: ServerResponse): boolean {
  const token = readToken(req);
  if (!browserBridgeService.validateToken(token)) {
    sendJson(res, 403, { success: false, error: 'Invalid session token' });
    return false;
  }
  return true;
}

function emitBridgeEvent(ctx: HostApiContext, eventName: string, payload: unknown): void {
  ctx.eventBus.emit(eventName, payload);
}

export async function handleBrowserBridgeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/browser-bridge')) {
    return false;
  }

  setBridgeCors(req, res);

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return true;
  }

  if (url.pathname === '/api/browser-bridge/auto-connect' && req.method === 'POST') {
    if (!isLoopback(req)) {
      sendJson(res, 403, { success: false, error: 'Auto-connect is localhost-only' });
      return true;
    }
    const body = await parseJsonBody<{ extensionVersion?: string }>(req);
    const compatibility = browserBridgeService.checkExtensionCompatibility(body.extensionVersion);
    if (!compatibility.compatible) {
      sendJson(res, 403, {
        success: false,
        error: 'BRIDGE_VERSION_MISMATCH',
        reason: compatibility.reason,
      });
      return true;
    }
    const paired = browserBridgeService.autoConnect(body.extensionVersion);
    if (!paired) {
      sendJson(res, 403, { success: false, error: 'Auto-connect is disabled in StoClaw' });
      return true;
    }
    sendJson(res, 200, { success: true, token: paired.token });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/settings' && req.method === 'GET') {
    if (!isLoopback(req)) {
      sendJson(res, 403, { success: false, error: 'Settings are localhost-only' });
      return true;
    }
    const settings = browserBridgeService.getSettings();
    const bundledVersion = getBundledBrowserBridgeExtensionVersion();
    const compatibility = browserBridgeService.checkExtensionCompatibility(
      settings.installedExtensionVersion,
    );
    const updateAvailable = compatibility.updateAvailable;
    sendJson(res, 200, {
      success: true,
      ...settings,
      bundledExtensionVersion: bundledVersion,
      updateAvailable,
    });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/settings' && req.method === 'POST') {
    if (!isLoopback(req)) {
      sendJson(res, 403, { success: false, error: 'Settings are localhost-only' });
      return true;
    }
    const body = await parseJsonBody<{ autoConnectEnabled?: boolean }>(req);
    if (typeof body.autoConnectEnabled === 'boolean') {
      browserBridgeService.setAutoConnectEnabled(body.autoConnectEnabled);
    }
    sendJson(res, 200, { success: true, ...browserBridgeService.getSettings() });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/extension-info' && req.method === 'GET') {
    const bundledVersion = getBundledBrowserBridgeExtensionVersion();
    const zipPath = resolveBrowserBridgeExtensionZipPath();
    sendJson(res, 200, {
      success: true,
      version: bundledVersion,
      downloadAvailable: Boolean(zipPath),
      downloadPath: '/api/browser-bridge/extension-download',
    });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/extension-download' && req.method === 'GET') {
    const zipPath = resolveBrowserBridgeExtensionZipPath();
    if (!zipPath || !existsSync(zipPath)) {
      sendJson(res, 404, { success: false, error: 'Extension package not found' });
      return true;
    }
    const buffer = readFileSync(zipPath);
    setBridgeCors(req, res);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${basename(zipPath)}"`);
    res.end(buffer);
    return true;
  }

  if (url.pathname === '/api/browser-bridge/pairing-code' && req.method === 'GET') {
    if (!isLoopback(req)) {
      sendJson(res, 403, { success: false, error: 'Pairing code is localhost-only' });
      return true;
    }
    const pairing = browserBridgeService.getPairingCode();
    sendJson(res, 200, { success: true, code: pairing?.code ?? null });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/pairing-code' && req.method === 'POST') {
    if (!isLoopback(req)) {
      sendJson(res, 403, { success: false, error: 'Pairing code is localhost-only' });
      return true;
    }
    const pairing = browserBridgeService.refreshPairingCode();
    sendJson(res, 200, { success: true, code: pairing.code });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/pair' && req.method === 'POST') {
    const body = await parseJsonBody<{ pairingCode?: string }>(req);
    const paired = browserBridgeService.pairWithCode(body.pairingCode ?? '');
    if (!paired) {
      sendJson(res, 400, { success: false, error: 'Invalid pairing code' });
      return true;
    }
    sendJson(res, 200, { success: true, token: paired.token });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/rotate-tokens' && req.method === 'POST') {
    if (!isLoopback(req)) {
      sendJson(res, 403, { success: false, error: 'Token rotation is localhost-only' });
      return true;
    }
    const body = await parseJsonBody<{ keepGraceMs?: number }>(req);
    browserBridgeService.rotateTokens({
      keepGraceMs: typeof body.keepGraceMs === 'number' ? body.keepGraceMs : undefined,
    });
    sendJson(res, 200, { success: true });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/connect' && req.method === 'POST') {
    if (!requireExtensionToken(req, res)) return true;
    const body = await parseJsonBody<{
      sessionId?: string;
      tabId?: number;
      url?: string;
      title?: string;
      extensionVersion?: string;
      groupId?: string;
      taskLabel?: string;
      ownership?: 'owned' | 'borrowed';
    }>(req);
    if (!body.sessionId || body.tabId === undefined) {
      sendJson(res, 400, { success: false, error: 'sessionId and tabId are required' });
      return true;
    }
    const compatibility = browserBridgeService.checkExtensionCompatibility(body.extensionVersion);
    if (!compatibility.compatible) {
      sendJson(res, 403, {
        success: false,
        error: 'BRIDGE_VERSION_MISMATCH',
        reason: compatibility.reason,
      });
      return true;
    }
    const session = browserBridgeService.connectSession({
      sessionId: body.sessionId,
      tabId: body.tabId,
      url: body.url ?? '',
      title: body.title ?? '',
      token: readToken(req) ?? '',
      extensionVersion: body.extensionVersion,
      groupId: body.groupId,
      taskLabel: body.taskLabel,
      ownership: body.ownership,
    });
    emitBridgeEvent(ctx, 'browser:connected', session);
    sendJson(res, 200, { success: true, sessionId: session.sessionId });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/heartbeat' && req.method === 'POST') {
    if (!requireExtensionToken(req, res)) return true;
    const body = await parseJsonBody<{ sessionId?: string; url?: string; title?: string }>(req);
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const session = browserBridgeService.heartbeat(body.sessionId, {
      url: body.url,
      title: body.title,
    });
    if (!session) {
      sendJson(res, 404, { success: false, error: 'Session not found' });
      return true;
    }
    sendJson(res, 200, { success: true });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/poll' && req.method === 'GET') {
    if (!requireExtensionToken(req, res)) return true;
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      sendJson(res, 400, { success: false, error: 'sessionId is required' });
      return true;
    }
    const commands = browserBridgeService.pollCommands(sessionId);
    sendJson(res, 200, { success: true, commands });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/command' && req.method === 'POST') {
    if (!isLoopback(req)) {
      sendJson(res, 403, { success: false, error: 'Command endpoint is localhost-only' });
      return true;
    }
    const body = await parseJsonBody<{
      sessionId?: string;
      action?: BrowserBridgeAction;
      payload?: Record<string, unknown>;
    }>(req);
    if (!body.sessionId || !body.action) {
      sendJson(res, 400, { success: false, error: 'sessionId and action are required' });
      return true;
    }
    const target = browserBridgeService.getSession(body.sessionId);
    if (!target) {
      sendJson(res, 404, { success: false, error: 'Session not found' });
      return true;
    }
    if (body.action === 'cdp') {
      const method = typeof body.payload?.method === 'string' ? body.payload.method : '';
      if (!method || !isCdpMethodAllowed(method)) {
        sendJson(res, 400, { success: false, error: 'CDP_METHOD_NOT_ALLOWED' });
        return true;
      }
    }
    if ((body.action === 'group_tabs' || body.action === 'mark_tabs') && target.source !== 'extension') {
      sendJson(res, 400, { success: false, error: `${body.action} is extension-only` });
      return true;
    }
    const command = browserBridgeService.enqueueCommand(
      body.sessionId,
      body.action,
      body.payload ?? {},
    );
    if (!command) {
      sendJson(res, 404, { success: false, error: 'Session not found' });
      return true;
    }
    if (body.sessionId.startsWith('embed-')) {
      const { flushSclawEmbedBridgeSession } = await import('../../main/services/sclaw-embed-bridge-driver');
      flushSclawEmbedBridgeSession(body.sessionId);
    }
    emitBridgeEvent(ctx, 'browser:command', { sessionId: body.sessionId, command });
    sendJson(res, 200, { success: true, commandId: command.commandId, command });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/result' && req.method === 'POST') {
    if (!requireExtensionToken(req, res)) return true;
    const body = await parseJsonBody<{
      sessionId?: string;
      commandId?: string;
      action?: BrowserBridgeAction;
      result?: unknown;
    }>(req);
    if (!body.sessionId || !body.commandId || !body.action) {
      sendJson(res, 400, { success: false, error: 'sessionId, commandId and action are required' });
      return true;
    }
    const stored = browserBridgeService.storeResult({
      sessionId: body.sessionId,
      commandId: body.commandId,
      action: body.action,
      result: body.result,
    });
    emitBridgeEvent(ctx, 'browser:result', stored);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/result' && req.method === 'GET') {
    if (!isLoopback(req)) {
      sendJson(res, 403, { success: false, error: 'Result polling is localhost-only' });
      return true;
    }
    const commandId = url.searchParams.get('commandId');
    if (!commandId) {
      sendJson(res, 400, { success: false, error: 'commandId is required' });
      return true;
    }
    const result = browserBridgeService.getResult(commandId);
    sendJson(res, 200, { success: true, ready: Boolean(result), result });
    return true;
  }

  if (url.pathname === '/api/browser-bridge/sessions' && req.method === 'GET') {
    const sessions = browserBridgeService.listActiveSessions().map((session) => ({
      sessionId: session.sessionId,
      tabId: session.tabId,
      url: session.url,
      title: session.title,
      connectedAt: session.connectedAt,
      lastHeartbeat: session.lastHeartbeat,
      source: session.source ?? 'extension',
      embedRuntimeId: session.embedRuntimeId,
      ownership: session.ownership,
      extensionVersion: session.extensionVersion,
      groupId: session.groupId,
      taskLabel: session.taskLabel,
    }));
    sendJson(res, 200, { success: true, sessions });
    return true;
  }

  return false;
}
