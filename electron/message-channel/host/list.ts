/**
 * Channel accounts list for Host API: OC-configured view + Hub DingTalk + Weixin Host merge.
 */
import {
  listConfiguredChannelAccounts,
  listConfiguredChannels,
  readOpenClawConfig,
} from '../../utils/channel-config';
import { listAgentsSnapshot } from '../../utils/agent-config';
import {
  computeChannelRuntimeStatus,
  pickChannelRuntimeStatus,
  type ChannelRuntimeAccountSnapshot,
} from '../../utils/channel-status';
import {
  OPENCLAW_WECHAT_CHANNEL_TYPE,
  UI_WECHAT_CHANNEL_TYPE,
  toUiChannelType,
} from '../../utils/channel-alias';
import { getChannelConnection } from '../hub/binding-service';
import { getSclawHubClient } from '../hub/hub-client';
import type { HostApiContext } from '../../api/context';

interface GatewayChannelStatusPayload {
  channelOrder?: string[];
  channels?: Record<string, unknown>;
  channelAccounts?: Record<string, Array<{
    accountId?: string;
    configured?: boolean;
    connected?: boolean;
    running?: boolean;
    lastError?: string;
    name?: string;
    linked?: boolean;
    lastConnectedAt?: number | null;
    lastInboundAt?: number | null;
    lastOutboundAt?: number | null;
    lastProbeAt?: number | null;
    probe?: {
      ok?: boolean;
    } | null;
  }>>;
  channelDefaultAccountId?: Record<string, string>;
}

export interface ChannelAccountView {
  accountId: string;
  name: string;
  configured: boolean;
  connected: boolean;
  running: boolean;
  linked: boolean;
  lastError?: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  isDefault: boolean;
  agentId?: string;
  engineType?: string;
}

export interface ChannelAccountsView {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountView[];
}

export async function buildChannelAccountsView(ctx: HostApiContext): Promise<ChannelAccountsView[]> {
  const [configuredChannels, configuredAccounts, openClawConfig, initialAgentsSnapshot] = await Promise.all([
    listConfiguredChannels(),
    listConfiguredChannelAccounts(),
    readOpenClawConfig(),
    listAgentsSnapshot(),
  ]);

  let gatewayStatus: GatewayChannelStatusPayload | null;
  try {
    gatewayStatus = await ctx.gatewayManager.rpc<GatewayChannelStatusPayload>('channels.status', { probe: true });
  } catch {
    gatewayStatus = null;
  }

  const channelTypes = new Set<string>([
    ...configuredChannels,
    ...Object.keys(configuredAccounts),
    ...Object.keys(gatewayStatus?.channelAccounts || {}),
  ]);

  const agentsSnapshot = initialAgentsSnapshot;
  const channels: ChannelAccountsView[] = [];
  for (const rawChannelType of channelTypes) {
    const uiChannelType = toUiChannelType(rawChannelType);
    const channelAccountsFromConfig = configuredAccounts[rawChannelType]?.accountIds ?? [];
    const hasLocalConfig = configuredChannels.includes(rawChannelType) || Boolean(configuredAccounts[rawChannelType]);
    const channelSection = openClawConfig.channels?.[rawChannelType];
    const channelSummary =
      (gatewayStatus?.channels?.[rawChannelType] as { error?: string; lastError?: string } | undefined) ?? undefined;
    const sortedConfigAccountIds = [...channelAccountsFromConfig].sort((left, right) => {
      if (left === 'default') return -1;
      if (right === 'default') return 1;
      return left.localeCompare(right);
    });
    const fallbackDefault =
      typeof channelSection?.defaultAccount === 'string' && channelSection.defaultAccount.trim()
        ? channelSection.defaultAccount
        : (sortedConfigAccountIds[0] || 'default');
    const defaultAccountId = configuredAccounts[rawChannelType]?.defaultAccountId
      ?? gatewayStatus?.channelDefaultAccountId?.[rawChannelType]
      ?? fallbackDefault;
    const runtimeAccounts = gatewayStatus?.channelAccounts?.[rawChannelType] ?? [];
    const hasRuntimeConfigured = runtimeAccounts.some((account) => account.configured === true);
    if (!hasLocalConfig && !hasRuntimeConfigured) {
      continue;
    }
    const runtimeAccountIds = runtimeAccounts
      .map((account) => account.accountId)
      .filter((accountId): accountId is string => typeof accountId === 'string' && accountId.trim().length > 0);
    const accountIds = Array.from(new Set([...channelAccountsFromConfig, ...runtimeAccountIds, defaultAccountId]));

    const accounts: ChannelAccountView[] = accountIds.map((accountId) => {
      const runtime = runtimeAccounts.find((item) => item.accountId === accountId);
      const runtimeSnapshot: ChannelRuntimeAccountSnapshot = runtime ?? {};
      const status = computeChannelRuntimeStatus(runtimeSnapshot);
      return {
        accountId,
        name: runtime?.name || accountId,
        configured: channelAccountsFromConfig.includes(accountId) || runtime?.configured === true,
        connected: runtime?.connected === true,
        running: runtime?.running === true,
        linked: runtime?.linked === true,
        lastError: typeof runtime?.lastError === 'string' ? runtime.lastError : undefined,
        status,
        isDefault: accountId === defaultAccountId,
        agentId: agentsSnapshot.channelAccountOwners[`${rawChannelType}:${accountId}`],
      };
    }).sort((left, right) => {
      if (left.accountId === defaultAccountId) return -1;
      if (right.accountId === defaultAccountId) return 1;
      return left.accountId.localeCompare(right.accountId);
    });

    channels.push({
      channelType: uiChannelType,
      defaultAccountId,
      status: pickChannelRuntimeStatus(runtimeAccounts, channelSummary),
      accounts,
    });
  }

  return channels.sort((left, right) => left.channelType.localeCompare(right.channelType));
}

/** Merge Host-Worker WeChat account into the channels list (independent of OC plugin). */
export async function mergeWeixinHostChannel(
  channels: ChannelAccountsView[],
): Promise<ChannelAccountsView[]> {
  try {
    const { getWeixinBinding } = await import('../weixin/binding');
    const { getWeixinChannelService } = await import('../weixin/service');
    // Prefer getWeixinBinding only — do not OR getBoundWeixinAccountId(), which
    // ignores revoked DB rows and would keep showing「解除绑定」after unbind.
    const binding = await getWeixinBinding();
    const accountId = binding?.accountId;
    if (!accountId) return channels;

    const svc = getWeixinChannelService();
    const connected = svc.isMonitorRunning();
    const status: ChannelAccountsView['status'] = connected
      ? 'connected'
      : svc.isReady()
        ? 'connecting'
        : 'disconnected';
    const weixinView: ChannelAccountsView = {
      channelType: UI_WECHAT_CHANNEL_TYPE,
      defaultAccountId: accountId,
      status,
      accounts: [
        {
          accountId,
          name: accountId,
          configured: true,
          connected,
          running: connected,
          linked: true,
          status,
          isDefault: true,
          agentId: binding?.agentId || 'main',
          engineType: binding?.engineType || 'pi',
        },
      ],
    };

    const withoutOcWeixin = channels.filter(
      (ch) => ch.channelType !== UI_WECHAT_CHANNEL_TYPE && ch.channelType !== OPENCLAW_WECHAT_CHANNEL_TYPE,
    );
    return [...withoutOcWeixin, weixinView].sort((a, b) =>
      a.channelType.localeCompare(b.channelType),
    );
  } catch {
    return channels;
  }
}

export async function mergeHubDingTalkChannel(
  channels: ChannelAccountsView[],
): Promise<ChannelAccountsView[]> {
  try {
    const hubConn = await getChannelConnection('dingtalk');
    if (!hubConn || hubConn.bindStatus !== 'bound') {
      return channels;
    }
    // 列表只读运行时状态；建连由启动/登录 ensureChannelRuntimesReady 负责。
    const ws = getSclawHubClient().getStatus();
    const status: ChannelAccountsView['status'] = ws.connected
      ? 'connected'
      : ws.state === 'connecting'
        ? 'connecting'
        : 'disconnected';
    const hubView: ChannelAccountsView = {
      channelType: 'dingtalk',
      defaultAccountId: 'default',
      status,
      accounts: [
        {
          accountId: 'default',
          name: hubConn.externalUserId
            ? `钉钉 Hub（${hubConn.externalUserId}）`
            : '钉钉 Hub',
          configured: true,
          connected: ws.connected,
          running: ws.connected,
          linked: true,
          status,
          isDefault: true,
          agentId: hubConn.agentId || undefined,
        },
      ],
    };
    const withoutOcDingTalk = channels.filter((item) => item.channelType !== 'dingtalk');
    return [...withoutOcDingTalk, hubView].sort((left, right) =>
      left.channelType.localeCompare(right.channelType),
    );
  } catch {
    return channels;
  }
}

/** OC base list + Hub DingTalk + Weixin Host overlays. */
export async function listMergedChannelAccounts(ctx: HostApiContext): Promise<ChannelAccountsView[]> {
  return mergeWeixinHostChannel(
    await mergeHubDingTalkChannel(await buildChannelAccountsView(ctx)),
  );
}
