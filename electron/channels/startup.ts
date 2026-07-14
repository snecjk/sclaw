import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import { getChannelConnection } from './binding-service';
import { getSclawHubClient } from './hub-client';
import { resolveSclawHubBaseUrl } from './hub-config';
import { handleSclawInbound, setChannelGatewayManager } from './ingress';

let inboundWired = false;

export function wireSclawInboundListener(): void {
  if (inboundWired) return;
  inboundWired = true;
  const client = getSclawHubClient();
  client.on('inbound', (msg) => {
    handleSclawInbound(msg);
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

    if (!resolveSclawHubBaseUrl()) {
      logger.info('[SclawHub] skip connect: hub base URL not configured');
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
