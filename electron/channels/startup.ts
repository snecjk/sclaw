import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import {
  getChannelConnection,
  getLocalDeviceId,
  resolveSharedHubRefreshToken,
  revokeDingTalkHubBind,
  syncSharedHubRefreshToken,
} from './binding-service';
import { hubBindStatus, hubSyncChannels } from './hub-api';
import { getSclawHubClient } from './hub-client';
import { resolveSclawHubBaseUrl } from './hub-config';
import { handleSclawInbound, setChannelGatewayManager } from './ingress';

let inboundWired = false;
let bindReplacedWired = false;

async function notifyRendererBindReplaced(reason: string): Promise<void> {
  try {
    const { BrowserWindow } = await import('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('channel:dingtalk-bind-replaced', { reason });
      }
    }
  } catch {
    // ignore outside Electron
  }
}

/**
 * 本机绑定已被 Hub 侧换走/解绑：停 WS、清本地 bound、通知 UI。
 */
export async function handleDingTalkBindReplaced(reason = 'bound_on_another_device'): Promise<void> {
  try {
    getSclawHubClient().disconnectPermanently();
    await revokeDingTalkHubBind();
    logger.info(`[SclawHub] local bind revoked reason=${reason}`);
    await notifyRendererBindReplaced(reason);
  } catch (error) {
    logger.warn('[SclawHub] handleDingTalkBindReplaced failed', error);
  }
}

/**
 * 对照 Hub status：若 remote.deviceId 不是本机，视为已被抢走。
 */
export async function syncDingTalkBindWithRemote(): Promise<'ok' | 'replaced' | 'unbound' | 'skip'> {
  try {
    if (!resolveSclawHubBaseUrl()) return 'skip';
    const local = await getChannelConnection('dingtalk');
    if (!local || local.bindStatus !== 'bound') return 'skip';

    const remote = await hubBindStatus();
    const localDeviceId = await getLocalDeviceId();
    if (!remote.bound) {
      await handleDingTalkBindReplaced('unbound');
      return 'unbound';
    }
    if (remote.deviceId && remote.deviceId !== localDeviceId) {
      await handleDingTalkBindReplaced('bound_on_another_device');
      return 'replaced';
    }
    return 'ok';
  } catch (error) {
    logger.warn('[SclawHub] syncDingTalkBindWithRemote failed', error);
    return 'skip';
  }
}

export function wireSclawInboundListener(): void {
  if (inboundWired) return;
  inboundWired = true;
  const client = getSclawHubClient();
  client.on('inbound', (msg) => {
    handleSclawInbound(msg);
  });
  client.on('historyRpc', (msg) => {
    void import('./history-facade').then(({ handleHistoryRpc }) => {
      void handleHistoryRpc(msg as {
        type: string;
        requestId?: string;
        payload?: {
          limit?: number;
          cursor?: string | null;
          sessionKey?: string;
        };
      });
    });
  });
}

function wireSclawBindReplacedListener(): void {
  if (bindReplacedWired) return;
  bindReplacedWired = true;
  getSclawHubClient().on('bindReplaced', (payload: { reason?: string }) => {
    void handleDingTalkBindReplaced(payload?.reason || 'bound_on_another_device');
  });
}

/**
 * 若已绑定钉钉或已开启 App：挂入站监听并用共用 refreshToken 确保 Desktop Hub WS 在线。
 * App / 钉钉共用一条 WS + 心跳（hub-client ping），不各起一套。
 *
 * 建连前用当前登录重新 register，避免换账号后仍连旧 token。
 */
export async function ensureSclawHubConnected(
  gatewayManager?: GatewayManager | null,
): Promise<void> {
  try {
    if (gatewayManager) {
      setChannelGatewayManager(gatewayManager);
    }
    wireSclawInboundListener();
    wireSclawBindReplacedListener();

    // Phase 1: start Weixin Host Worker when credentials exist (independent of Hub).
    void import('../message-channel/weixin/service').then(({ getWeixinChannelService }) => {
      const svc = getWeixinChannelService();
      if (gatewayManager) svc.setGatewayManager(gatewayManager);
      return svc.start(gatewayManager ?? null);
    }).catch((error) => {
      logger.warn('[Weixin] channel service start failed', error);
    });

    if (!resolveSclawHubBaseUrl()) {
      logger.info('[SclawHub] skip connect: hub base URL not configured');
      return;
    }

    const sync = await syncDingTalkBindWithRemote();
    if (sync === 'replaced' || sync === 'unbound') {
      logger.info(`[SclawHub] skip connect after sync=${sync}`);
      return;
    }

    // 本地持有任一通道凭证时，把两条通道的真实状态同步到 Hub，再复用共享 token 建连。
    const existing = await resolveSharedHubRefreshToken();
    if (!existing) {
      logger.info('[SclawHub] skip connect: no shared hub refreshToken (dingtalk/mobile)');
      return;
    }

    const [dingtalk, mobile] = await Promise.all([
      getChannelConnection('dingtalk'),
      getChannelConnection('mobile'),
    ]);
    let refreshToken = existing;
    try {
      const synced = await hubSyncChannels([
        {
          channelType: 'dingtalk',
          status: dingtalk?.bindStatus === 'bound' ? 'bound' : 'revoked',
          externalUserId: dingtalk?.externalUserId ?? null,
        },
        {
          channelType: 'mobile',
          status: mobile?.bindStatus === 'bound' ? 'bound' : 'revoked',
        },
      ]);
      if (synced.refreshToken) {
        refreshToken = synced.refreshToken;
        await syncSharedHubRefreshToken({
          refreshToken,
          dingUserId: dingtalk?.externalUserId ?? null,
          endpointBaseUrl: resolveSclawHubBaseUrl() || null,
        });
      }
    } catch (error) {
      // Hub 先发、Desktop 后发的兼容窗口：同步失败时仍用旧共享凭证，不反向误开 Mobile。
      logger.warn('[SclawHub] channel state sync failed; fallback to existing token', error);
    }

    const hub = getSclawHubClient();
    if (hub.getStatus().connected) {
      hub.disconnect();
    }
    await hub.connect(refreshToken);
    logger.info('[SclawHub] reconnect ok (fresh register)');
  } catch (error) {
    logger.warn('[SclawHub] reconnect failed', error);
  }
}

/** @deprecated 语义保留：启动时调用 ensureSclawHubConnected */
export async function maybeConnectSclawHubOnStartup(
  gatewayManager?: GatewayManager | null,
): Promise<void> {
  return ensureSclawHubConnected(gatewayManager);
}
