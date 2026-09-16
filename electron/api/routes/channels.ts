/**
 * Channel Host API thin shell: OC config CRUD + accounts list (delegates merge to message-channel/host).
 * WeChat QR login lives in message-channel/weixin/routes.ts.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import {
  deleteChannelAccountConfig,
  deleteChannelConfig,
  getChannelFormValues,
  listConfiguredChannels,
  saveChannelConfig,
  setChannelDefaultAccount,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../../utils/channel-config';
import {
  assignChannelAccountToAgent,
  clearAllBindingsForChannel,
  clearChannelBinding,
  listAgentsSnapshot,
} from '../../utils/agent-config';
import {
  OPENCLAW_WECHAT_CHANNEL_TYPE,
  UI_WECHAT_CHANNEL_TYPE,
  toOpenClawChannelType,
  toUiChannelType,
} from '../../utils/channel-alias';
import { getChannelConfigSaveRejection } from '../../../shared/retired-openclaw-channels';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { listMergedChannelAccounts } from '../../message-channel/host/list';

function resolveStoredChannelType(channelType: string): string {
  return toOpenClawChannelType(channelType);
}

function scheduleGatewayChannelRestart(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state === 'stopped') {
    return;
  }
  ctx.gatewayManager.debouncedRestart();
  void reason;
}

type ChannelGatewayRefreshKind = 'config' | 'binding';

function scheduleGatewayChannelSaveRefresh(
  ctx: HostApiContext,
  channelType: string,
  reason: string,
  kind: ChannelGatewayRefreshKind = 'config',
): void {
  void channelType;
  if (ctx.gatewayManager.getStatus().state === 'stopped') {
    return;
  }

  if (kind === 'binding') {
    ctx.gatewayManager.debouncedReload();
    void reason;
    return;
  }

  ctx.gatewayManager.debouncedReload();
  void reason;
}

function toComparableConfig(input: Record<string, unknown>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      next[key] = value.trim();
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      next[key] = String(value);
    }
  }
  return next;
}

function isSameConfigValues(
  existing: Record<string, string> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!existing) return false;
  const next = toComparableConfig(incoming);
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
  if (keys.size === 0) return false;
  for (const key of keys) {
    if ((existing[key] ?? '') !== (next[key] ?? '')) {
      return false;
    }
  }
  return true;
}

async function ensureScopedChannelBinding(channelType: string, accountId?: string): Promise<void> {
  const storedChannelType = resolveStoredChannelType(channelType);
  // Multi-agent safety: only bind when the caller explicitly scopes the account.
  // Global channel saves (no accountId) must not override routing to "main".
  if (!accountId) return;
  const agents = await listAgentsSnapshot();
  if (!agents.agents || agents.agents.length === 0) return;

  const ownerKey = `${storedChannelType}:${accountId}`;
  if (agents.channelAccountOwners[ownerKey]) {
    return;
  }

  // Keep backward compatibility for the legacy default account.
  if (accountId === 'default') {
    if (agents.agents.some((entry) => entry.id === 'main')) {
      await assignChannelAccountToAgent('main', storedChannelType, 'default');
    }
    return;
  }

  // Legacy compatibility: if accountId matches an existing agentId, keep auto-binding.
  if (agents.agents.some((entry) => entry.id === accountId)) {
    await assignChannelAccountToAgent(accountId, storedChannelType, accountId);
  }
}

export async function handleChannelRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/channels/configured' && req.method === 'GET') {
    const channels = await listConfiguredChannels();
    sendJson(res, 200, { success: true, channels: Array.from(new Set(channels.map((channel) => toUiChannelType(channel)))) });
    return true;
  }

  if (url.pathname === '/api/channels/accounts' && req.method === 'GET') {
    try {
      const channels = await listMergedChannelAccounts(ctx);
      sendJson(res, 200, { success: true, channels });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/default-account' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; accountId: string }>(req);
      await setChannelDefaultAccount(body.channelType, body.accountId);
      scheduleGatewayChannelSaveRefresh(ctx, body.channelType, `channel:setDefaultAccount:${body.channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/binding' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; accountId: string; agentId: string }>(req);
      await assignChannelAccountToAgent(body.agentId, resolveStoredChannelType(body.channelType), body.accountId);
      scheduleGatewayChannelSaveRefresh(ctx, body.channelType, `channel:setBinding:${body.channelType}`, 'binding');
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/binding' && req.method === 'DELETE') {
    try {
      const body = await parseJsonBody<{ channelType: string; accountId: string }>(req);
      await clearChannelBinding(resolveStoredChannelType(body.channelType), body.accountId);
      scheduleGatewayChannelSaveRefresh(ctx, body.channelType, `channel:clearBinding:${body.channelType}`, 'binding');
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelConfig(body.channelType)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/credentials/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, string> }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelCredentials(body.channelType, body.config)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, unknown>; accountId?: string }>(req);
      const storedChannelType = resolveStoredChannelType(body.channelType);
      const saveRejection = getChannelConfigSaveRejection(storedChannelType);
      if (saveRejection) {
        sendJson(res, 410, {
          success: false,
          error: saveRejection.error,
        });
        return true;
      }
      if (storedChannelType === OPENCLAW_WECHAT_CHANNEL_TYPE) {
        // Phase 1: WeChat uses Host Worker — skip OC plugin install.
      }
      const existingValues = await getChannelFormValues(body.channelType, body.accountId);
      if (isSameConfigValues(existingValues, body.config)) {
        await ensureScopedChannelBinding(body.channelType, body.accountId);
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await saveChannelConfig(body.channelType, body.config, body.accountId);
      await ensureScopedChannelBinding(body.channelType, body.accountId);
      scheduleGatewayChannelSaveRefresh(ctx, storedChannelType, `channel:saveConfig:${storedChannelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config/enabled' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; enabled: boolean }>(req);
      await setChannelEnabled(body.channelType, body.enabled);
      scheduleGatewayChannelRestart(ctx, `channel:setEnabled:${resolveStoredChannelType(body.channelType)}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'GET') {
    try {
      const channelType = decodeURIComponent(url.pathname.slice('/api/channels/config/'.length));
      const accountId = url.searchParams.get('accountId') || undefined;
      sendJson(res, 200, {
        success: true,
        values: await getChannelFormValues(channelType, accountId),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'DELETE') {
    try {
      const channelType = decodeURIComponent(url.pathname.slice('/api/channels/config/'.length));
      const accountId = url.searchParams.get('accountId') || undefined;
      const storedChannelType = resolveStoredChannelType(channelType);
      if (accountId) {
        await deleteChannelAccountConfig(channelType, accountId);
        await clearChannelBinding(storedChannelType, accountId);
        scheduleGatewayChannelSaveRefresh(ctx, storedChannelType, `channel:deleteAccount:${storedChannelType}`);
      } else {
        await deleteChannelConfig(channelType);
        await clearAllBindingsForChannel(storedChannelType);
        scheduleGatewayChannelRestart(ctx, `channel:deleteConfig:${storedChannelType}`);
      }
      if (
        toUiChannelType(channelType) === UI_WECHAT_CHANNEL_TYPE
        || storedChannelType === OPENCLAW_WECHAT_CHANNEL_TYPE
      ) {
        const removeId =
          accountId?.trim()
          || (await import('../../message-channel/weixin/binding')).getBoundWeixinAccountId()
          || 'default';
        const { unbindWeixinBot } = await import('../../message-channel/weixin/binding');
        const { getWeixinChannelService } = await import('../../message-channel/weixin/service');
        await getWeixinChannelService().stopMonitor();
        getWeixinChannelService().sendCommand({ type: 'account.remove', accountId: removeId });
        await unbindWeixinBot();
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  void ctx;
  return false;
}
