/**
 * WeChat Host API: QR login start/cancel under /api/channels/wechat/*.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import {
  UI_WECHAT_CHANNEL_TYPE,
  buildQrChannelEventName,
  toUiChannelType,
} from '../../utils/channel-alias';
import type { HostApiContext } from '../../api/context';
import { parseJsonBody, sendJson } from '../../api/route-utils';
import {
  cancelWeChatLoginSession,
  saveWeChatAccountState,
  startWeChatLoginSession,
  waitForWeChatLoginSession,
} from './host-login';

const WECHAT_QR_TIMEOUT_MS = 8 * 60 * 1000;
const activeQrLogins = new Map<string, string>();

interface WebLoginStartResult {
  qrcodeUrl?: string;
  message?: string;
  sessionKey?: string;
}

function buildQrLoginKey(channelType: string, accountId?: string): string {
  return `${toUiChannelType(channelType)}:${accountId?.trim() || '__new__'}`;
}

function setActiveQrLogin(channelType: string, sessionKey: string, accountId?: string): string {
  const loginKey = buildQrLoginKey(channelType, accountId);
  activeQrLogins.set(loginKey, sessionKey);
  return loginKey;
}

function isActiveQrLogin(loginKey: string, sessionKey: string): boolean {
  return activeQrLogins.get(loginKey) === sessionKey;
}

function clearActiveQrLogin(channelType: string, accountId?: string): void {
  activeQrLogins.delete(buildQrLoginKey(channelType, accountId));
}

function emitChannelEvent(
  ctx: HostApiContext,
  channelType: string,
  event: 'qr' | 'success' | 'error',
  payload: unknown,
): void {
  const eventName = buildQrChannelEventName(channelType, event);
  ctx.eventBus.emit(eventName, payload);
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(eventName, payload);
  }
}

async function startWeChatQrLogin(accountId?: string): Promise<WebLoginStartResult> {
  return await startWeChatLoginSession({
    ...(accountId ? { accountId } : {}),
    force: true,
  });
}

async function awaitWeChatQrLogin(
  ctx: HostApiContext,
  sessionKey: string,
  loginKey: string,
): Promise<void> {
  try {
    const result = await waitForWeChatLoginSession({
      sessionKey,
      timeoutMs: WECHAT_QR_TIMEOUT_MS,
      onQrRefresh: async ({ qrcodeUrl }) => {
        if (!isActiveQrLogin(loginKey, sessionKey)) {
          return;
        }
        emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'qr', {
          qr: qrcodeUrl,
          raw: qrcodeUrl,
          sessionKey,
        });
      },
    });

    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }

    if (!result.connected || !result.accountId || !result.botToken) {
      emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'error', result.message || 'WeChat login did not complete');
      return;
    }

    const normalizedAccountId = await saveWeChatAccountState(result.accountId, {
      token: result.botToken,
      baseUrl: result.baseUrl,
      userId: result.userId,
    });
    // Phase 1: Host Worker owns transport — do NOT enable OC openclaw-weixin plugin.
    const { getWeixinChannelService } = await import('./service');
    getWeixinChannelService().setGatewayManager(ctx.gatewayManager);
    await getWeixinChannelService().applyLoginSuccess({
      accountId: normalizedAccountId,
      token: result.botToken,
      baseUrl: result.baseUrl,
      userId: result.userId,
      agentId: 'main',
    });

    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }

    emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'success', {
      accountId: normalizedAccountId,
      rawAccountId: result.accountId,
      message: result.message,
    });
  } catch (error) {
    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }
    emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'error', String(error));
  } finally {
    if (isActiveQrLogin(loginKey, sessionKey)) {
      activeQrLogins.delete(loginKey);
    }
    await cancelWeChatLoginSession(sessionKey);
  }
}

export async function handleWeixinChannelRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/channels/wechat/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId?: string }>(req);
      const requestedAccountId = body.accountId?.trim() || undefined;

      const { getWeixinChannelService } = await import('./service');
      // Single-Bot: allow re-scan to refresh/replace the local slot.
      // Phase 1: Host Worker path — do NOT install OC WeChat plugin.
      const startResult = await startWeChatQrLogin(requestedAccountId);
      if (!startResult.qrcodeUrl || !startResult.sessionKey) {
        throw new Error(startResult.message || 'Failed to generate WeChat QR code');
      }

      const loginKey = setActiveQrLogin(UI_WECHAT_CHANNEL_TYPE, startResult.sessionKey, requestedAccountId);
      emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'qr', {
        qr: startResult.qrcodeUrl,
        raw: startResult.qrcodeUrl,
        sessionKey: startResult.sessionKey,
      });
      void awaitWeChatQrLogin(ctx, startResult.sessionKey, loginKey);
      void getWeixinChannelService().ensureReady().catch(() => {});
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/wechat/cancel' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId?: string }>(req);
      const accountId = body.accountId?.trim() || undefined;
      const loginKey = buildQrLoginKey(UI_WECHAT_CHANNEL_TYPE, accountId);
      const sessionKey = activeQrLogins.get(loginKey);
      clearActiveQrLogin(UI_WECHAT_CHANNEL_TYPE, accountId);
      if (sessionKey) {
        await cancelWeChatLoginSession(sessionKey);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
