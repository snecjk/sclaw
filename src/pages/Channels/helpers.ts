import { cn } from '@/lib/utils';
import { CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentEngineType } from '../../../shared/agent-engine';
import type {
  AgentItem,
  ChannelAccountItem,
  ChannelGroupItem,
  DeleteTarget,
  DingTalkBindingState,
} from './types';

const CHANNEL_STATUS_DOT_CLASS: Record<ChannelGroupItem['status'], string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  error: 'bg-destructive',
  disconnected: 'bg-[#C9CDD4]',
};

export function tintChannelSvg(raw: string, color: string): string {
  return raw
    .replace(/<\?xml[\s\S]*?\?>/i, '')
    .replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/\sfill="[^"]*"/gi, '')
    .replace(/<svg\b/i, `<svg fill="${color}"`)
    .replace(/\s(width|height)="[^"]*"/gi, '');
}

export function removeDeletedTarget(
  groups: ChannelGroupItem[],
  target: DeleteTarget,
): ChannelGroupItem[] {
  if (target.accountId) {
    return groups
      .map((group) => {
        if (group.channelType !== target.channelType) return group;
        return {
          ...group,
          accounts: group.accounts.filter((account) => account.accountId !== target.accountId),
        };
      })
      .filter((group) => group.accounts.length > 0);
  }

  return groups.filter((group) => group.channelType !== target.channelType);
}

export function channelStatusDotClass(status: ChannelGroupItem['status']) {
  return cn('h-2 w-2 shrink-0 rounded-full', CHANNEL_STATUS_DOT_CLASS[status]);
}

export function resolveAgentEngine(agent: AgentItem): AgentEngineType {
  if (agent.engineType === 'claude' || agent.engineType === 'pi') {
    return agent.engineType;
  }
  return 'openclaw';
}

/** Prefer agents matching the engine; for Claude, fall back to the main agent. */
export function agentsForEngine(agents: AgentItem[], engine: AgentEngineType): AgentItem[] {
  const matched = agents.filter((agent) => resolveAgentEngine(agent) === engine);
  if (matched.length > 0) return matched;
  if (engine === 'claude') {
    const mainAgent = agents.find((agent) => agent.id === 'main');
    if (mainAgent) return [mainAgent];
  }
  return matched;
}

export function pickSelectedAgentId(
  options: AgentItem[],
  preferredId: string | null | undefined,
): string | undefined {
  if (options.some((agent) => agent.id === preferredId)) {
    return preferredId || options[0]?.id;
  }
  return options[0]?.id;
}

export function accountDisplayName(
  account: ChannelAccountItem | undefined,
  mainAccountLabel: string,
): string | null {
  if (!account) return null;
  if (account.accountId === 'default' && account.name === account.accountId) {
    return mainAccountLabel;
  }
  return account.name;
}

export function normalizeLogoType(channelType: string): ChannelType {
  return (channelType === 'openclaw-weixin' ? 'wechat' : channelType) as ChannelType;
}

export function channelTitle(channelType: string): string {
  if (channelType === 'openclaw-weixin') return CHANNEL_NAMES.wechat;
  return CHANNEL_NAMES[channelType as ChannelType] || channelType;
}

export function parseStoredEngineType(
  value: string | null | undefined,
  fallback: AgentEngineType,
): AgentEngineType {
  if (value === 'openclaw' || value === 'claude' || value === 'pi') return value;
  return fallback;
}

export function toBindingEngine(engine: string | null | undefined): AgentEngineType {
  if (engine === 'openclaw' || engine === 'pi') return engine;
  return 'claude';
}

export function resolveNextAgentForEngine(
  agents: AgentItem[],
  nextEngine: AgentEngineType,
  preferredAgentId: string | null | undefined,
): string {
  const options = agentsForEngine(agents, nextEngine);
  return options.find((agent) => agent.id === preferredAgentId)?.id || options[0]?.id || '';
}

export function configuredChannelSubtitle(params: {
  isDingTalk: boolean;
  isWeChat: boolean;
  dingTalkBinding: DingTalkBindingState;
  weChatAccount?: ChannelAccountItem;
  pluginAccount?: ChannelAccountItem;
  weChatDisplayName: string | null;
  pluginDisplayName: string | null;
  t: (key: string, options?: Record<string, string>) => string;
}): string {
  const {
    isDingTalk,
    isWeChat,
    dingTalkBinding,
    weChatAccount,
    pluginAccount,
    weChatDisplayName,
    pluginDisplayName,
    t,
  } = params;
  const boundHint = t('hub.dingtalk.boundStatusHint', { defaultValue: '已绑定' });

  if (isDingTalk) {
    if (dingTalkBinding?.replaceHint === 'other_device') {
      return t('hub.dingtalk.replacedByOtherDevice');
    }
    if (dingTalkBinding?.replaceHint === 'unbound') {
      return t('hub.dingtalk.replacedUnbound');
    }
    if (dingTalkBinding?.bindStatus !== 'bound') {
      return t('hub.dingtalk.notBoundHint', { defaultValue: '未绑定，点击扫码绑定' });
    }
    return boundHint;
  }

  if (isWeChat) {
    if (!weChatAccount) return t('account.bindingStatus.unbound');
    return weChatDisplayName || boundHint;
  }

  if (!pluginAccount) return t('account.bindingStatus.unbound');
  return pluginDisplayName || boundHint;
}
