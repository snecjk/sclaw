import type { Capability } from '../../../../shared/jsbridge/capabilities';
import { CONSENT_CAPABILITIES, isCapability } from '../../../../shared/jsbridge/capabilities';
import { isBridgeRequest, type BridgeRequest, type BridgeResponse } from '../../../../shared/jsbridge/protocol';
import { isStoCnOrigin, matchAnyOriginPattern, originFromUrl } from '../../../../shared/jsbridge/origin-policy';
import { webContents } from 'electron';
import {
  ReplayGuard,
  bridgeFailure,
  buildBridgeResponse,
  validateRequestTimestamp,
  verifySessionToken,
} from './auth-service';
import { handleAppGetInfo } from './handlers/app';
import { handleAuthGetAuthMode, handleAuthGetToken, handleAuthGetUser, handleAuthRequestLogin } from './handlers/auth';
import { handleBridgeGetCapabilities, handleBridgePing } from './handlers/bridge-meta';
import { handleChatFillComposer, handleChatOpenSession, handleChatSendMessage } from './handlers/chat';
import { handleChatCancel, handleChatComplete } from './handlers/chat-ai';
import { handleComposerOpenFilePicker, handleNavOpenPreviewTab } from './handlers/composer';
import {
  handleNavCloseSelf,
  handleNavGoBack,
  handleNavJump,
  handleNavOpenApp,
  handleNavOpenExternal,
  handleNavOpenTab,
  handleNavReload,
} from './handlers/navigation';
import {
  handleStorageClear,
  handleStorageGet,
  handleStorageRemove,
  handleStorageSet,
} from './handlers/storage';
import { handleChatTogglePanel, handleUiToast } from './handlers/ui';
import { handleUiAlert, handleUiConfirm, handleUiOpenDrawer } from './handlers/ui-dialog';
import { handleUserGetInfo } from './handlers/user';
import type { BridgeHandlerFn } from './handlers/types';
import {
  destroyBridgeSession,
  getBridgeSession,
  refreshBridgeSessionOrigin,
  type BridgeSession,
} from './session-registry';
import { logger } from '../../../utils/logger';

const replayGuard = new ReplayGuard();

const HANDLERS: Record<string, BridgeHandlerFn> = {
  'bridge.ping': handleBridgePing,
  'bridge.getCapabilities': handleBridgeGetCapabilities,
  'app.getInfo': handleAppGetInfo,
  'user.getInfo': handleUserGetInfo,
  'auth.getUser': handleAuthGetUser,
  'auth.getAuthMode': handleAuthGetAuthMode,
  'auth.getToken': handleAuthGetToken,
  'auth.requestLogin': handleAuthRequestLogin,
  'nav.openTab': handleNavOpenTab,
  'nav.openApp': handleNavOpenApp,
  'nav.jump': handleNavJump,
  'nav.openExternal': handleNavOpenExternal,
  'nav.closeSelf': handleNavCloseSelf,
  'nav.goBack': handleNavGoBack,
  'nav.reload': handleNavReload,
  'storage.get': handleStorageGet,
  'storage.set': handleStorageSet,
  'storage.remove': handleStorageRemove,
  'storage.clear': handleStorageClear,
  'ui.toast': handleUiToast,
  'ui.alert': handleUiAlert,
  'ui.confirm': handleUiConfirm,
  'ui.openDrawer': handleUiOpenDrawer,
  'chat.togglePanel': handleChatTogglePanel,
  'chat.fillComposer': handleChatFillComposer,
  'chat.openSession': handleChatOpenSession,
  'chat.sendMessage': handleChatSendMessage,
  'chat.complete': handleChatComplete,
  'chat.cancel': handleChatCancel,
  'composer.openFilePicker': handleComposerOpenFilePicker,
  'nav.openPreviewTab': handleNavOpenPreviewTab,
};

const RATE_LIMIT_BY_TIER: Record<BridgeSession['trustPolicy']['trustTier'], number> = {
  internal: 300,
  catalog: 120,
  external: 60,
  untrusted: 20,
};

function resolveCurrentPageUrl(session: BridgeSession): string | null {
  const wc = webContents.fromId(session.webContentsId);
  if (!wc || wc.isDestroyed()) return session.currentOrigin ? `${session.currentOrigin}/` : null;
  try {
    return wc.getURL();
  } catch {
    return session.currentOrigin ? `${session.currentOrigin}/` : null;
  }
}

function assertSessionAuthorized(
  session: BridgeSession,
  request: BridgeRequest,
  webContentsId: number,
  sessionToken?: string,
): BridgeResponse | null {
  if (session.webContentsId !== webContentsId) {
    return bridgeFailure(request, 'INVALID_SESSION', 'Session webContents mismatch');
  }
  if (Date.now() > session.expiresAt) {
    destroyBridgeSession(session.sessionId, 'session_expired');
    return bridgeFailure(request, 'SESSION_EXPIRED', 'Bridge session expired');
  }
  if (sessionToken && sessionToken !== session.sessionToken) {
    return bridgeFailure(request, 'INVALID_SESSION', 'Invalid session token');
  }
  if (!verifySessionToken({
    sessionId: session.sessionId,
    webContentsId: session.webContentsId,
    bindOrigin: session.bindOrigin,
    expiresAt: session.expiresAt,
    sessionToken: session.sessionToken,
  })) {
    destroyBridgeSession(session.sessionId, 'invalid_token');
    return bridgeFailure(request, 'INVALID_SESSION', 'Invalid session token');
  }
  if (!validateRequestTimestamp(request.timestamp)) {
    return bridgeFailure(request, 'REPLAY_DETECTED', 'Request timestamp out of range');
  }

  const pageUrl = resolveCurrentPageUrl(session);
  if (!pageUrl) {
    return bridgeFailure(request, 'ORIGIN_DENIED', 'Unable to resolve page URL');
  }
  const origin = originFromUrl(pageUrl);
  if (!origin || !isStoCnOrigin(origin)) {
    destroyBridgeSession(session.sessionId, 'origin_not_sto_cn');
    return bridgeFailure(request, 'ORIGIN_DENIED', 'Only *.sto.cn origins are allowed');
  }
  if (!matchAnyOriginPattern(session.trustPolicy.allowedOrigins, origin)) {
    destroyBridgeSession(session.sessionId, 'origin_not_in_app_policy');
    return bridgeFailure(request, 'ORIGIN_DENIED', 'Origin not allowed for this app');
  }
  refreshBridgeSessionOrigin(session, pageUrl);

  const method = request.method;
  if (!isCapability(method)) {
    return bridgeFailure(request, 'METHOD_NOT_FOUND', `Unknown method: ${method}`);
  }
  if (!session.grantedCapabilities.has(method)) {
    if ((CONSENT_CAPABILITIES as readonly string[]).includes(method)) {
      // Do not consume the request id here — Host may retry the same envelope
      // after the user grants consent (see maybeGrantConsent).
      return bridgeFailure(request, 'USER_CONSENT_REQUIRED', 'User consent required', {
        capability: method,
        appId: session.trustPolicy.appId,
      });
    }
    return bridgeFailure(request, 'CAPABILITY_DENIED', `Capability denied: ${method}`);
  }

  if (!replayGuard.consume(`${session.sessionId}:${request.id}`)) {
    return bridgeFailure(request, 'REPLAY_DETECTED', 'Duplicate request id');
  }

  const limit = RATE_LIMIT_BY_TIER[session.trustPolicy.trustTier];
  const now = Date.now();
  if (now - session.rateWindowStart >= 60_000) {
    session.rateWindowStart = now;
    session.invokeCount = 0;
  }
  session.invokeCount += 1;
  if (session.invokeCount > limit) {
    return bridgeFailure(request, 'RATE_LIMITED', 'Too many bridge invocations');
  }

  session.lastActiveAt = now;
  return null;
}

export async function dispatchBridgeInvoke(input: {
  request: unknown;
  webContentsId: number;
  sessionToken?: string;
}): Promise<BridgeResponse> {
  if (!isBridgeRequest(input.request)) {
    return {
      protocol: 'stoclaw-bridge/v1',
      version: '1.0.0',
      type: 'response',
      id: typeof (input.request as BridgeRequest)?.id === 'string'
        ? (input.request as BridgeRequest).id
        : 'invalid',
      ok: false,
      error: { code: 'INVALID_PROTOCOL', message: 'Invalid bridge request envelope' },
    };
  }

  const request = input.request;
  const session = getBridgeSession(request.sessionId);
  if (!session) {
    return bridgeFailure(request, 'INVALID_SESSION', 'Bridge session not found');
  }

  const authError = assertSessionAuthorized(session, request, input.webContentsId, input.sessionToken);
  if (authError) return authError;

  const handler = HANDLERS[request.method];
  if (!handler) {
    return bridgeFailure(request, 'METHOD_NOT_FOUND', `Unknown method: ${request.method}`);
  }

  try {
    const data = await handler({ session, request });
    return buildBridgeResponse(request, { ok: true, data });
  } catch (error) {
    const err = error as Error & { code?: string };
    const code = (err.code as BridgeResponse['error'] extends infer E ? E extends { code: infer C } ? C : never : never)
      ?? 'INTERNAL_ERROR';
    if (code === 'AUTH_REQUIRED') {
      return bridgeFailure(request, 'AUTH_REQUIRED', err.message || 'Authentication required');
    }
    if (code === 'PERMISSION_DENIED') {
      return bridgeFailure(request, 'PERMISSION_DENIED', err.message || 'Permission denied');
    }
    if (code === 'INVALID_PARAMS') {
      return bridgeFailure(request, 'INVALID_PARAMS', err.message || 'Invalid parameters');
    }
    if (code === 'ORIGIN_DENIED') {
      return bridgeFailure(request, 'ORIGIN_DENIED', err.message || 'Origin denied');
    }
    if (code === 'AI_NOT_ENABLED') {
      return bridgeFailure(request, 'AI_NOT_ENABLED', err.message || 'AI is not enabled for this app');
    }
    if (code === 'AI_INVALID_PARAMS') {
      return bridgeFailure(request, 'INVALID_PARAMS', err.message || 'Invalid AI parameters', { aiCode: code });
    }
    if (code === 'AI_CONTEXT_TOO_LARGE') {
      return bridgeFailure(request, 'INVALID_PARAMS', err.message || 'AI context too large', { aiCode: code });
    }
    if (code === 'AI_RUN_FAILED') {
      return bridgeFailure(request, 'INTERNAL_ERROR', err.message || 'AI run failed', { aiCode: code });
    }
    if (code === 'AI_SKILL_NOT_ALLOWED') {
      return bridgeFailure(request, 'PERMISSION_DENIED', err.message || 'Skill not allowed', { aiCode: code });
    }
    if (code === 'AI_QUOTA_EXCEEDED' || code === 'AI_CONCURRENCY_EXCEEDED') {
      return bridgeFailure(request, 'RATE_LIMITED', err.message || 'AI quota exceeded', { aiCode: code });
    }
    logger.warn('[jsbridge] handler error', { method: request.method, error: err.message });
    return bridgeFailure(request, 'INTERNAL_ERROR', err.message || 'Internal bridge error');
  }
}

export function listRegisteredBridgeMethods(): Capability[] {
  return Object.keys(HANDLERS).filter(isCapability) as Capability[];
}
