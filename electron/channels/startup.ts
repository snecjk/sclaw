import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import {
  getChannelConnection,
  getLocalDeviceId,
  revokeDingTalkHubBind,
} from './binding-service';
import { hubBindStatus } from './hub-api';
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
 * 若已绑定钉钉 Hub：挂入站监听并用 refreshToken 确保 WS 在线。
 * 用于进程启动、登录成功、以及频道列表兜底重连。
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

    if (!resolveSclawHubBaseUrl()) {
      logger.info('[SclawHub] skip connect: hub base URL not configured');
      return;
    }

    const sync = await syncDingTalkBindWithRemote();
    if (sync === 'replaced' || sync === 'unbound') {
      logger.info(`[SclawHub] skip connect after sync=${sync}`);
      return;
    }

    const conn = await getChannelConnection('dingtalk');
    if (!conn || conn.bindStatus !== 'bound' || !conn.refreshToken) {
      logger.info('[SclawHub] skip connect: dingtalk not bound');
      return;
    }
    const status = getSclawHubClient().getStatus();
    if (status.connected) {
      return;
    }
    await getSclawHubClient().connect(conn.refreshToken);
    logger.info('[SclawHub] reconnect ok');
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
