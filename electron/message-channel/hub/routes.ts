import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostApiContext } from '../../api/context';
import { parseJsonBody, sendJson } from '../../api/route-utils';
import {
  disableMobileAppBind,
  enableMobileAppBind,
  getChannelConnection,
  getLocalDeviceId,
  revokeDingTalkHubBind,
  syncSharedHubRefreshToken,
  updateDingTalkBindingAgent,
  updateMobileBindingAgent,
  upsertDingTalkHubBind,
} from './binding-service';
import {
  hubBindStatus,
  hubClaimBind,
  hubCreateBind,
  hubDisableChannel,
  hubPollBind,
  hubRegisterDesktop,
  hubUnbindRemote,
} from './hub-api';
import { getSclawHubClient } from './hub-client';
import { resolveSclawHubBaseUrl } from './hub-config';
import { setChannelGatewayManager } from './ingress';
import { wireSclawInboundListener } from './startup';
import { logger } from '../../utils/logger';

/**
 * Host API：钉钉 Channel Hub 绑定 / 连接。
 */
export async function handleChannelHubRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/channels/hub')) {
    return false;
  }

  setChannelGatewayManager(ctx.gatewayManager);
  wireSclawInboundListener();

  try {
    if (url.pathname === '/api/channels/hub/config' && req.method === 'GET') {
      sendJson(res, 200, {
        success: true,
        hubBaseUrl: resolveSclawHubBaseUrl() || null,
        configured: Boolean(resolveSclawHubBaseUrl()),
      });
      return true;
    }

    if (url.pathname === '/api/channels/hub/dingtalk/status' && req.method === 'GET') {
      const local = await getChannelConnection('dingtalk');
      const client = getSclawHubClient().getStatus();
      let remote: unknown = null;
      try {
        if (resolveSclawHubBaseUrl()) {
          remote = await hubBindStatus();
        }
      } catch (error) {
        remote = { error: String(error) };
      }
      sendJson(res, 200, {
        success: true,
        local,
        ws: client,
        remote,
        deviceId: await getLocalDeviceId(),
      });
      return true;
    }

    if (url.pathname === '/api/channels/hub/dingtalk/bind/create' && req.method === 'POST') {
      const data = await hubCreateBind();
      sendJson(res, 200, { success: true, ...data });
      return true;
    }

    if (url.pathname === '/api/channels/hub/dingtalk/bind/poll' && req.method === 'GET') {
      const bindToken = url.searchParams.get('bindToken') || '';
      if (!bindToken) {
        sendJson(res, 400, { success: false, error: 'bindToken required' });
        return true;
      }
      const data = await hubPollBind(bindToken);
      sendJson(res, 200, { success: true, ...data });
      return true;
    }

    if (url.pathname === '/api/channels/hub/dingtalk/bind/claim' && req.method === 'POST') {
      const body = await parseJsonBody<{ ticket?: string; deviceId?: string }>(req);
      if (!body.ticket) {
        sendJson(res, 400, { success: false, error: 'ticket required' });
        return true;
      }
      const claimed = await hubClaimBind(body.ticket, body.deviceId);
      const conn = await upsertDingTalkHubBind({
        externalUserId: claimed.dingUserId,
        refreshToken: claimed.refreshToken,
        endpointBaseUrl: resolveSclawHubBaseUrl() || null,
      });
      // 与 App 共用一条 Hub 绑定：同步 refreshToken 到 mobile 本地行
      await syncSharedHubRefreshToken({
        refreshToken: claimed.refreshToken,
        dingUserId: claimed.dingUserId,
        endpointBaseUrl: resolveSclawHubBaseUrl() || null,
      });
      try {
        await getSclawHubClient().connect(claimed.refreshToken);
      } catch (error) {
        logger.warn('[ChannelHub] WS connect after claim failed', error);
      }
      sendJson(res, 200, { success: true, connection: conn, claimed });
      return true;
    }

    if (url.pathname === '/api/channels/hub/dingtalk/bind/unbind' && req.method === 'POST') {
      if (resolveSclawHubBaseUrl()) {
        await hubUnbindRemote();
      }
      await revokeDingTalkHubBind();
      const mobile = await getChannelConnection('mobile');
      if (!mobile || mobile.bindStatus !== 'bound') {
        getSclawHubClient().disconnect();
      }
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === '/api/channels/hub/dingtalk/ws/connect' && req.method === 'POST') {
      const local = await getChannelConnection('dingtalk');
      if (!local?.refreshToken || local.bindStatus !== 'bound') {
        sendJson(res, 400, { success: false, error: 'not bound' });
        return true;
      }
      await getSclawHubClient().connect(local.refreshToken);
      sendJson(res, 200, { success: true, ws: getSclawHubClient().getStatus() });
      return true;
    }

    if (url.pathname === '/api/channels/hub/dingtalk/ws/disconnect' && req.method === 'POST') {
      getSclawHubClient().disconnect();
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === '/api/channels/hub/dingtalk/binding/agent' && req.method === 'POST') {
      const body = await parseJsonBody<{ engineType?: 'claude' | 'pi'; agentId?: string }>(req);
      if (!body.engineType || !body.agentId) {
        sendJson(res, 400, { success: false, error: 'engineType and agentId required' });
        return true;
      }
      const conn = await updateDingTalkBindingAgent({
        engineType: body.engineType,
        agentId: body.agentId,
      });
      sendJson(res, 200, { success: true, connection: conn });
      return true;
    }

    // ── mobile / 企业 App 本地通道 ─────────────────────────────

    if (url.pathname === '/api/channels/hub/mobile/status' && req.method === 'GET') {
      const local = await getChannelConnection('mobile');
      const dingTalk = await getChannelConnection('dingtalk');
      const client = getSclawHubClient().getStatus();
      // App / 钉钉共用一条 Desktop Hub WS + 心跳（hub-client ping）；凭证取任一本地行即可
      const sharedToken = local?.refreshToken || dingTalk?.refreshToken || null;
      const canConnectWs = Boolean(sharedToken);
      sendJson(res, 200, {
        success: true,
        local,
        ws: client,
        canConnectWs,
        deviceId: await getLocalDeviceId(),
      });
      return true;
    }

    if (url.pathname === '/api/channels/hub/mobile/bind/enable' && req.method === 'POST') {
      let wsError: string | null = null;
      let refreshToken: string | null = null;
      try {
        const registered = await hubRegisterDesktop();
        refreshToken = registered.refreshToken;
        await enableMobileAppBind({ refreshToken });
        await syncSharedHubRefreshToken({
          refreshToken,
          dingUserId: registered.dingUserId ?? null,
          endpointBaseUrl: resolveSclawHubBaseUrl() || null,
        });
        try {
          // 共用一条 WS/心跳：已连接则用新 token 重连一次；未连接则新建（不另起第二套心跳）
          const hub = getSclawHubClient();
          if (hub.getStatus().connected) {
            hub.disconnect();
          }
          await hub.connect(refreshToken);
        } catch (error) {
          wsError = String(error);
          logger.warn('[ChannelHub] WS connect after mobile enable failed', error);
        }
      } catch (error) {
        logger.error('[ChannelHub] mobile hub register failed', error);
        sendJson(res, 500, { success: false, error: String(error) });
        return true;
      }
      const conn = await getChannelConnection('mobile');
      sendJson(res, 200, {
        success: true,
        connection: conn,
        ws: getSclawHubClient().getStatus(),
        wsError,
      });
      return true;
    }

    if (url.pathname === '/api/channels/hub/mobile/bind/disable' && req.method === 'POST') {
      if (resolveSclawHubBaseUrl()) {
        await hubDisableChannel('mobile');
      }
      await disableMobileAppBind();
      const dingTalk = await getChannelConnection('dingtalk');
      // 无钉钉绑定时可断开共用 WS；仍有钉钉则保持
      if (!dingTalk || dingTalk.bindStatus !== 'bound') {
        getSclawHubClient().disconnect();
      }
      sendJson(res, 200, { success: true, ws: getSclawHubClient().getStatus() });
      return true;
    }

    if (url.pathname === '/api/channels/hub/mobile/binding/agent' && req.method === 'POST') {
      const body = await parseJsonBody<{ engineType?: 'claude' | 'pi'; agentId?: string }>(req);
      if (!body.engineType || !body.agentId) {
        sendJson(res, 400, { success: false, error: 'engineType and agentId required' });
        return true;
      }
      const conn = await updateMobileBindingAgent({
        engineType: body.engineType,
        agentId: body.agentId,
      });
      sendJson(res, 200, { success: true, connection: conn });
      return true;
    }
  } catch (error) {
    logger.error('[ChannelHub] route error', error);
    sendJson(res, 500, { success: false, error: String(error) });
    return true;
  }

  sendJson(res, 404, { success: false, error: `No route for ${req.method} ${url.pathname}` });
  return true;
}
