import type { GatewayManager } from '../../gateway/manager';
import { logger } from '../../utils/logger';
import {
  getChannelConnection,
  getLocalDeviceId,
  ensureFixedChannelBindings,
  resolveSharedHubRefreshToken,
  revokeDingTalkHubBind,
  syncSharedHubRefreshToken,
  type ChannelConnection,
} from './binding-service';
import { hubBindStatus, hubSyncChannels } from './hub-api';
import { getSclawHubClient } from './hub-client';
import { resolveSclawHubBaseUrl } from './hub-config';
import { handleSclawInbound, setChannelGatewayManager } from './ingress';

let inboundWired = false;
let bindReplacedWired = false;

export type ChannelRuntimePlan = {
  hub: {
    shouldAttempt: boolean;
    dingtalkBound: boolean;
    mobileBound: boolean;
    dingtalkRow: ChannelConnection | null;
    mobileRow: ChannelConnection | null;
  };
  weixin: {
    shouldStartWorker: boolean;
  };
};

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
    void import('../mobile/history-facade').then(({ handleHistoryRpc }) => {
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
 * 轻量探测（微信侧可能触发一次凭证迁移写盘）。不含可 connect 的最终 refreshToken。
 */
export async function probeChannelRuntimeNeeds(): Promise<ChannelRuntimePlan> {
  const [dingtalkRow, mobileRow] = await Promise.all([
    getChannelConnection('dingtalk'),
    getChannelConnection('mobile'),
  ]);

  const hasHubBaseUrl = Boolean(resolveSclawHubBaseUrl());
  const mobileHasToken = Boolean(
    mobileRow?.bindStatus === 'bound'
    && mobileRow.enabled
    && mobileRow.refreshToken,
  );
  const dingtalkHasToken = Boolean(
    dingtalkRow?.bindStatus === 'bound'
    && dingtalkRow.refreshToken,
  );

  let shouldStartWorker = false;
  try {
    const { hasWeixinBotBound } = await import('../weixin/binding');
    shouldStartWorker = hasWeixinBotBound();
  } catch (error) {
    logger.warn('[ChannelRuntime] weixin probe failed', error);
  }

  return {
    hub: {
      shouldAttempt: hasHubBaseUrl && (mobileHasToken || dingtalkHasToken),
      dingtalkBound: dingtalkRow?.bindStatus === 'bound',
      mobileBound: Boolean(mobileRow?.bindStatus === 'bound' && mobileRow.enabled !== false),
      dingtalkRow,
      mobileRow,
    },
    weixin: { shouldStartWorker },
  };
}

async function syncHubChannelStatesAndConnect(input: {
  refreshToken: string;
  plan: ChannelRuntimePlan;
}): Promise<void> {
  const { refreshToken, plan } = input;
  let token = refreshToken;
  const dingtalk = plan.hub.dingtalkRow;
  const mobile = plan.hub.mobileRow;

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
      token = synced.refreshToken;
      await syncSharedHubRefreshToken({
        refreshToken: token,
        dingUserId: dingtalk?.externalUserId ?? null,
        endpointBaseUrl: resolveSclawHubBaseUrl() || null,
      });
    }
  } catch (error) {
    logger.warn('[SclawHub] channel state sync failed; fallback to existing token', error);
  }

  const hub = getSclawHubClient();
  if (hub.getStatus().connected) {
    hub.disconnect();
  }
  await hub.connect(token);
  logger.info('[SclawHub] reconnect ok (fresh register)');
}

/**
 * 渠道运行时按需拉起：有凭证才起微信 Worker / Hub WS。
 * token 必须在 syncDingTalkBindWithRemote 之后再取。
 */
export async function ensureChannelRuntimesReady(
  gatewayManager?: GatewayManager | null,
): Promise<void> {
  try {
    if (gatewayManager) {
      setChannelGatewayManager(gatewayManager);
    }
    wireSclawInboundListener();
    wireSclawBindReplacedListener();

    // Normalize bound rows to pi+main before probe/skip — must not hang on connect/start.
    try {
      await ensureFixedChannelBindings();
    } catch (error) {
      logger.warn('[ChannelRuntime] ensureFixedChannelBindings failed', error);
    }

    const plan = await probeChannelRuntimeNeeds();

    if (plan.weixin.shouldStartWorker) {
      void import('../weixin/service').then(({ getWeixinChannelService }) => {
        const svc = getWeixinChannelService();
        if (gatewayManager) svc.setGatewayManager(gatewayManager);
        return svc.start(gatewayManager ?? null);
      }).catch((error) => {
        logger.warn('[ChannelRuntime] weixin start failed', error);
      });
    } else {
      logger.info('[ChannelRuntime] skip Weixin worker: no local credentials');
    }

    if (!plan.hub.shouldAttempt) {
      logger.info('[ChannelRuntime] skip Hub path: no baseUrl or usable bound token');
      return;
    }

    const sync = await syncDingTalkBindWithRemote();
    if (sync === 'replaced' || sync === 'unbound') {
      logger.info(`[ChannelRuntime] skip Hub connect after sync=${sync}`);
      return;
    }

    const refreshToken = await resolveSharedHubRefreshToken();
    if (!refreshToken) {
      logger.info('[ChannelRuntime] skip Hub connect: no shared refreshToken after sync');
      return;
    }

    await syncHubChannelStatesAndConnect({ refreshToken, plan });
  } catch (error) {
    logger.warn('[ChannelRuntime] ensureChannelRuntimesReady failed', error);
  }
}

/** @deprecated 使用 ensureChannelRuntimesReady */
export async function ensureSclawHubConnected(
  gatewayManager?: GatewayManager | null,
): Promise<void> {
  return ensureChannelRuntimesReady(gatewayManager);
}

/** @deprecated 语义保留：启动时调用 ensureChannelRuntimesReady */
export async function maybeConnectSclawHubOnStartup(
  gatewayManager?: GatewayManager | null,
): Promise<void> {
  return ensureChannelRuntimesReady(gatewayManager);
}
