import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Trash2, AlertCircle, Plus, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { DingTalkHubBindModal } from '@/components/channels/DingTalkHubBindModal';
import { cn } from '@/lib/utils';
import { stoSettingsSectionCardClass } from '@/lib/surfaces';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
} from '@/types/channel';
import { usesPluginManagedQrAccounts } from '@/lib/channel-alias';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

interface AgentItem {
  id: string;
  name: string;
  engineType?: 'claude' | 'openclaw';
}

interface DeleteTarget {
  channelType: string;
  accountId?: string;
}

interface InlineSelectOption {
  value: string;
  label: string;
}

const inlineSelectTriggerClass = cn(
  'flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-[#E5E6EB] bg-white px-2.5 text-left text-[12px] font-medium text-[#1D2129]',
  'shadow-none outline-none transition-colors hover:bg-[#F7F8FA]',
  'focus-visible:ring-2 focus-visible:ring-ring/30',
  'dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]',
);

const inlineSelectMenuClass = cn(
  'z-50 rounded-[8px] border border-[#E5E6EB] bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]',
  'dark:border-border dark:bg-card',
);

function ChannelInlineSelect({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  disabled,
}: {
  value: string;
  options: InlineSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            inlineSelectTriggerClass,
            disabled && 'cursor-not-allowed opacity-70 hover:bg-white dark:hover:bg-transparent',
            className,
          )}
          aria-label={ariaLabel}
          disabled={disabled}
        >
          <span className="min-w-0 flex-1 truncate">{selected?.label || '—'}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#86909C]" aria-hidden strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      {!disabled ? (
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={4}
          avoidCollisions={false}
          className={cn(inlineSelectMenuClass, 'w-[var(--radix-dropdown-menu-trigger-width)]')}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <DropdownMenuItem
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-[#1D2129]',
                  'focus:bg-[#F7F8FA] dark:text-foreground dark:focus:bg-white/[0.06]',
                  isSelected && 'bg-[#F7F8FA] dark:bg-white/[0.06]',
                )}
                onSelect={() => onChange(option.value)}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {isSelected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

function removeDeletedTarget(groups: ChannelGroupItem[], target: DeleteTarget): ChannelGroupItem[] {
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

function channelStatusDotClass(status: ChannelGroupItem['status']) {
  return cn(
    'h-2 w-2 shrink-0 rounded-full',
    status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting'
        ? 'bg-yellow-500 animate-pulse'
        : status === 'error'
          ? 'bg-destructive'
          : 'bg-[#C9CDD4]',
  );
}

export function Channels() {
  const { t } = useTranslation(['channels', 'common']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const lastGatewayStateRef = useRef(gatewayStatus.state);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [dingTalkBinding, setDingTalkBinding] = useState<{
    engineType?: 'claude' | 'openclaw' | null;
    agentId?: string | null;
  } | null>(null);
  /** 切换引擎后若当前 Agent 不兼容，先本地记下引擎，等用户显式选 Agent 再保存 */
  const [pendingDingTalkEngine, setPendingDingTalkEngine] = useState<'claude' | 'openclaw' | null>(
    null,
  );
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showDingTalkHubModal, setShowDingTalkHubModal] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [allowExistingConfigInModal, setAllowExistingConfigInModal] = useState(true);
  const [allowEditAccountIdInModal, setAllowEditAccountIdInModal] = useState(false);
  const [existingAccountIdsForModal, setExistingAccountIdsForModal] = useState<string[]>([]);
  const [initialConfigValuesForModal, setInitialConfigValuesForModal] = useState<Record<string, string> | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const displayedChannelTypes = getPrimaryChannels();

  const fetchPageData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [channelsRes, agentsRes, dingTalkStatusRes] = await Promise.all([
        hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[]; error?: string }>('/api/channels/accounts'),
        hostApiFetch<{ success: boolean; agents?: AgentItem[]; error?: string }>('/api/agents'),
        hostApiFetch<{
          success: boolean;
          local?: { engineType?: string | null; agentId?: string | null } | null;
        }>('/api/channels/hub/dingtalk/status').catch(() => null),
      ]);

      if (!channelsRes.success) {
        throw new Error(channelsRes.error || 'Failed to load channels');
      }

      if (!agentsRes.success) {
        throw new Error(agentsRes.error || 'Failed to load agents');
      }

      setChannelGroups(channelsRes.channels || []);
      setAgents(agentsRes.agents || []);

      const local = dingTalkStatusRes?.success ? dingTalkStatusRes.local : null;
      const engineType =
        local?.engineType === 'openclaw' || local?.engineType === 'claude'
          ? local.engineType
          : null;
      setDingTalkBinding(
        local
          ? {
              engineType,
              agentId: local.agentId ?? null,
            }
          : null,
      );
      setPendingDingTalkEngine(null);
    } catch (fetchError) {
      setError(String(fetchError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchPageData();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchPageData]);

  useEffect(() => {
    const previousGatewayState = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;

    if (previousGatewayState !== 'running' && gatewayStatus.state === 'running') {
      void fetchPageData();
    }
  }, [fetchPageData, gatewayStatus.state]);

  const configuredTypes = useMemo(
    () => channelGroups.map((group) => group.channelType),
    [channelGroups],
  );

  const groupedByType = useMemo(() => {
    return Object.fromEntries(channelGroups.map((group) => [group.channelType, group]));
  }, [channelGroups]);

  const configuredGroups = useMemo(() => {
    const known = displayedChannelTypes
      .map((type) => groupedByType[type])
      .filter((group): group is ChannelGroupItem => Boolean(group));
    const unknown = channelGroups.filter((group) => !displayedChannelTypes.includes(group.channelType as ChannelType));
    return [...known, ...unknown];
  }, [channelGroups, displayedChannelTypes, groupedByType]);

  const unsupportedGroups = displayedChannelTypes.filter((type) => !configuredTypes.includes(type));

  const handleRefresh = () => {
    void fetchPageData();
  };

  const openDingTalkHub = () => {
    setShowDingTalkHubModal(true);
  };

  const handleDingTalkBindingChange = async (next: {
    engineType: 'claude' | 'openclaw';
    agentId: string;
  }) => {
    if (!next.agentId) {
      toast.error(
        t('hub.dingtalk.agentRequired', {
          defaultValue: '请先创建或选择要绑定的 Agent',
        }),
      );
      return;
    }
    try {
      await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/hub/dingtalk/binding/agent', {
        method: 'POST',
        body: JSON.stringify(next),
      });
      setDingTalkBinding(next);
      await fetchPageData();
      toast.success(t('toast.bindingUpdated'));
    } catch (bindError) {
      toast.error(t('toast.configFailed', { error: String(bindError) }));
    }
  };

  const handleBindAgent = async (channelType: string, accountId: string, agentId: string) => {
    try {
      if (channelType === 'dingtalk') {
        const agent = agents.find((item) => item.id === agentId);
        const engineType = agent?.engineType === 'openclaw' ? 'openclaw' : 'claude';
        await handleDingTalkBindingChange({ engineType, agentId });
        return;
      } else if (!agentId) {
        await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/binding', {
          method: 'DELETE',
          body: JSON.stringify({ channelType, accountId }),
        });
      } else {
        await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/binding', {
          method: 'PUT',
          body: JSON.stringify({ channelType, accountId, agentId }),
        });
      }
      await fetchPageData();
      toast.success(t('toast.bindingUpdated'));
    } catch (bindError) {
      toast.error(t('toast.configFailed', { error: String(bindError) }));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.channelType === 'dingtalk') {
        await hostApiFetch('/api/channels/hub/dingtalk/bind/unbind', { method: 'POST' });
      } else {
        const suffix = deleteTarget.accountId
          ? `?accountId=${encodeURIComponent(deleteTarget.accountId)}`
          : '';
        await hostApiFetch(`/api/channels/config/${encodeURIComponent(deleteTarget.channelType)}${suffix}`, {
          method: 'DELETE',
        });
      }
      setChannelGroups((prev) => removeDeletedTarget(prev, deleteTarget));
      toast.success(deleteTarget.accountId ? t('toast.accountDeleted') : t('toast.channelDeleted'));
      // Channel reload is debounced in main process; pull again shortly to
      // converge with runtime state without flashing deleted rows back in.
      window.setTimeout(() => {
        void fetchPageData();
      }, 1200);
    } catch (deleteError) {
      toast.error(t('toast.configFailed', { error: String(deleteError) }));
    } finally {
      setDeleteTarget(null);
    }
  };

  const createNewAccountId = (channelType: string, existingAccounts: string[]): string => {
    // Generate a collision-safe default account id for user editing.
    let nextAccountId = `${channelType}-${crypto.randomUUID().slice(0, 8)}`;
    while (existingAccounts.includes(nextAccountId)) {
      nextAccountId = `${channelType}-${crypto.randomUUID().slice(0, 8)}`;
    }
    return nextAccountId;
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <>
      <header className="shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[20px] font-bold leading-tight text-[#1D2129] dark:text-foreground">
              {t('title')}
            </h1>
            <p className="mt-2 text-[14px] font-normal leading-relaxed text-[#86909C] dark:text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={gatewayStatus.state !== 'running'}
            className="h-8 shrink-0 rounded-md border-[#E5E6EB] bg-white px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t('refresh')}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        {gatewayStatus.state !== 'running' && (
          <div className="flex items-center gap-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-[13px] font-medium text-amber-800 dark:text-amber-300">
              {t('gatewayWarning')}
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-[8px] border border-destructive/30 bg-destructive/5 px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            <span className="text-[13px] font-medium text-destructive">{error}</span>
          </div>
        )}

        {configuredGroups.length > 0 && (
          <section className={stoSettingsSectionCardClass}>
            <h2 className="mb-5 text-[16px] font-semibold tracking-tight text-[#1D2129] dark:text-foreground">
              {t('configured')}
            </h2>
            <div className="divide-y divide-[#E5E6EB] dark:divide-border">
              {configuredGroups.map((group) => {
                const isDingTalk = group.channelType === 'dingtalk';
                const isWeChat = group.channelType === 'openclaw-weixin' || group.channelType === 'wechat';
                const boundAgentId =
                  (isDingTalk ? dingTalkBinding?.agentId : null) ||
                  group.accounts.find((item) => item.agentId)?.agentId;
                const boundAgent = boundAgentId
                  ? agents.find((agent) => agent.id === boundAgentId)
                  : undefined;
                const boundEngineType = isWeChat
                  ? 'openclaw'
                  : (isDingTalk ? dingTalkBinding?.engineType : null) ||
                    boundAgent?.engineType ||
                    null;
                const boundEngineLabel =
                  boundEngineType === 'openclaw'
                    ? 'OpenClaw'
                    : boundEngineType === 'claude'
                      ? 'Claude'
                      : null;
                const boundAgentName = boundAgent?.name;
                const resolveAgentEngine = (agent: AgentItem): 'claude' | 'openclaw' =>
                  agent.engineType === 'claude' ? 'claude' : 'openclaw';
                const dingTalkEngine: 'claude' | 'openclaw' =
                  boundEngineType === 'openclaw' ? 'openclaw' : 'claude';
                const mainAgent = agents.find((agent) => agent.id === 'main');
                const engineMatchedAgents = agents.filter(
                  (agent) => resolveAgentEngine(agent) === dingTalkEngine,
                );
                // Claude 尚未创建专用 Agent 时，仅回退展示 Main Agent（下拉无其他项）
                const dingTalkAgentOptions =
                  engineMatchedAgents.length > 0
                    ? engineMatchedAgents
                    : dingTalkEngine === 'claude' && mainAgent
                      ? [mainAgent]
                      : engineMatchedAgents;
                const dingTalkSelectedAgentId = dingTalkAgentOptions.some(
                  (agent) => agent.id === boundAgentId,
                )
                  ? boundAgentId || dingTalkAgentOptions[0]?.id
                  : dingTalkAgentOptions[0]?.id;
                const dingTalkSelectedAgentName = dingTalkSelectedAgentId
                  ? agents.find((agent) => agent.id === dingTalkSelectedAgentId)?.name
                  : undefined;

                const channelSubtitle =
                  isDingTalk && (boundEngineLabel || dingTalkSelectedAgentName)
                    ? t('hub.dingtalk.boundHint', {
                        defaultValue: '引擎：{{engine}} · {{agent}}',
                        engine: boundEngineLabel || t('account.unassigned'),
                        agent: dingTalkSelectedAgentName || t('account.unassigned'),
                      })
                    : boundEngineLabel || boundAgentName
                    ? t('hub.dingtalk.boundHint', {
                        defaultValue: '引擎：{{engine}} · {{agent}}',
                        engine: boundEngineLabel || t('account.unassigned'),
                        agent: boundAgentName || t('account.unassigned'),
                      })
                    : !isDingTalk && group.accounts.length > 1
                      ? t('account.accountCount', {
                          defaultValue: '{{count}} 个账号',
                          count: group.accounts.length,
                        })
                      : group.channelType;

                return (
                  <div key={group.channelType} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E5E6EB] bg-[#F7F8FA] dark:border-border dark:bg-muted/40">
                          <ChannelLogo type={group.channelType as ChannelType} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                              {CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType}
                            </h3>
                            <div className={channelStatusDotClass(group.status)} />
                          </div>
                          <p className="mt-0.5 text-[12px] text-[#86909C] dark:text-muted-foreground">
                            {channelSubtitle}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
                        {isDingTalk ? (
                          <>
                            <ChannelInlineSelect
                              className="w-[120px]"
                              value={dingTalkEngine}
                              ariaLabel={t('hub.dingtalk.engineLabel')}
                              options={[
                                { value: 'claude', label: 'Claude' },
                                { value: 'openclaw', label: 'OpenClaw' },
                              ]}
                              onChange={(nextValue) => {
                                const nextEngine =
                                  nextValue === 'openclaw' ? 'openclaw' : 'claude';
                                const matched = agents.filter(
                                  (agent) => resolveAgentEngine(agent) === nextEngine,
                                );
                                const fallbackMain =
                                  nextEngine === 'claude'
                                    ? agents.find((agent) => agent.id === 'main')
                                    : undefined;
                                const options =
                                  matched.length > 0
                                    ? matched
                                    : fallbackMain
                                      ? [fallbackMain]
                                      : [];
                                const nextAgentId =
                                  options.find((agent) => agent.id === boundAgentId)?.id ||
                                  options[0]?.id ||
                                  '';
                                if (!nextAgentId) {
                                  toast.error(
                                    t('hub.dingtalk.noAgentsForEngine', {
                                      defaultValue: '该引擎下暂无 Agent，请先创建后再切换',
                                    }),
                                  );
                                  return;
                                }
                                void handleDingTalkBindingChange({
                                  engineType: nextEngine,
                                  agentId: nextAgentId,
                                });
                              }}
                            />
                            <ChannelInlineSelect
                              className="w-[140px]"
                              value={dingTalkSelectedAgentId || ''}
                              ariaLabel={t('hub.dingtalk.agentLabel')}
                              options={dingTalkAgentOptions.map((agent) => ({
                                value: agent.id,
                                label: agent.name,
                              }))}
                              onChange={(nextAgentId) => {
                                if (!nextAgentId) return;
                                void handleDingTalkBindingChange({
                                  engineType: dingTalkEngine,
                                  agentId: nextAgentId,
                                });
                              }}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
                              onClick={openDingTalkHub}
                            >
                              {t('account.edit')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
                            onClick={() => {
                              const shouldUseGeneratedAccountId = !usesPluginManagedQrAccounts(group.channelType);
                              const nextAccountId = shouldUseGeneratedAccountId
                                ? createNewAccountId(
                                    group.channelType,
                                    group.accounts.map((item) => item.accountId),
                                  )
                                : undefined;
                              setSelectedChannelType(group.channelType as ChannelType);
                              setSelectedAccountId(nextAccountId);
                              setAllowExistingConfigInModal(false);
                              setAllowEditAccountIdInModal(shouldUseGeneratedAccountId);
                              setExistingAccountIdsForModal(group.accounts.map((item) => item.accountId));
                              setInitialConfigValuesForModal(undefined);
                              setShowConfigModal(true);
                            }}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            {t('account.add')}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-[#86909C] hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteTarget({ channelType: group.channelType })}
                          title={t('account.deleteChannel')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {!isDingTalk && group.accounts.length > 0 && (
                      <div className="mt-3 border-t border-[#E5E6EB] dark:border-border">
                        {group.accounts.map((account) => {
                          const displayName =
                            account.accountId === 'default' && account.name === account.accountId
                              ? t('account.mainAccount')
                              : account.name;
                          return (
                            <div
                              key={`${group.channelType}-${account.accountId}`}
                              className="flex flex-row items-center justify-between gap-3 py-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-medium text-[#1D2129] dark:text-foreground">
                                  {displayName}
                                </p>
                                {account.lastError && (
                                  <p className="mt-1 text-[12px] text-destructive">{account.lastError}</p>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
                                {isWeChat ? (
                                  <ChannelInlineSelect
                                    className="w-[120px]"
                                    value="openclaw"
                                    disabled
                                    ariaLabel={t('hub.dingtalk.engineLabel')}
                                    options={[
                                      { value: 'claude', label: 'Claude' },
                                      { value: 'openclaw', label: 'OpenClaw' },
                                    ]}
                                    onChange={() => undefined}
                                  />
                                ) : null}
                                <ChannelInlineSelect
                                  className="w-[140px]"
                                  value={account.agentId || ''}
                                  ariaLabel={t('account.bindAgentLabel')}
                                  options={[
                                    { value: '', label: t('account.unassigned') },
                                    ...agents.map((agent) => ({
                                      value: agent.id,
                                      label: agent.name,
                                    })),
                                  ]}
                                  onChange={(nextAgentId) => {
                                    void handleBindAgent(
                                      group.channelType,
                                      account.accountId,
                                      nextAgentId,
                                    );
                                  }}
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
                                  onClick={() => {
                                    void (async () => {
                                      try {
                                        const accountParam = `?accountId=${encodeURIComponent(account.accountId)}`;
                                        const result = await hostApiFetch<{
                                          success: boolean;
                                          values?: Record<string, string>;
                                        }>(
                                          `/api/channels/config/${encodeURIComponent(group.channelType)}${accountParam}`,
                                        );
                                        setInitialConfigValuesForModal(
                                          result.success ? result.values || {} : undefined,
                                        );
                                      } catch {
                                        setInitialConfigValuesForModal(undefined);
                                      }
                                      setSelectedChannelType(group.channelType as ChannelType);
                                      setSelectedAccountId(account.accountId);
                                      setAllowExistingConfigInModal(true);
                                      setAllowEditAccountIdInModal(false);
                                      setExistingAccountIdsForModal([]);
                                      setShowConfigModal(true);
                                    })();
                                  }}
                                >
                                  {t('account.edit')}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-[#86909C] hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() =>
                                    setDeleteTarget({
                                      channelType: group.channelType,
                                      accountId: account.accountId,
                                    })
                                  }
                                  title={t('account.delete')}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {unsupportedGroups.length > 0 && (
          <section className={stoSettingsSectionCardClass}>
            <h2 className="mb-5 text-[16px] font-semibold tracking-tight text-[#1D2129] dark:text-foreground">
              {t('supportedChannels')}
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {unsupportedGroups.map((type) => {
                const meta = CHANNEL_META[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      if (type === 'dingtalk') {
                        openDingTalkHub();
                        return;
                      }
                      setSelectedChannelType(type);
                      setSelectedAccountId(undefined);
                      setAllowExistingConfigInModal(true);
                      setAllowEditAccountIdInModal(false);
                      setExistingAccountIdsForModal([]);
                      setInitialConfigValuesForModal(undefined);
                      setShowConfigModal(true);
                    }}
                    className="group flex items-center gap-3 rounded-[8px] border border-[#E5E6EB] bg-white p-4 text-left transition-colors hover:border-[#C9CDD4] hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:hover:bg-white/[0.04]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E5E6EB] bg-[#F7F8FA] dark:border-border dark:bg-muted/40">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                          {meta.name}
                        </h3>
                        {meta.isPlugin && (
                          <Badge
                            variant="secondary"
                            className="rounded px-1.5 py-0 text-[10px] font-medium border-0 bg-[#F2F3F5] text-[#86909C] shadow-none dark:bg-white/[0.08] dark:text-muted-foreground"
                          >
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="line-clamp-2 text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
                        {t(meta.description.replace('channels:', ''))}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {showDingTalkHubModal && (
        <DingTalkHubBindModal
          onClose={() => setShowDingTalkHubModal(false)}
          onChanged={async () => {
            await fetchPageData();
          }}
        />
      )}

      {showConfigModal && (
        <ChannelConfigModal
          initialSelectedType={selectedChannelType}
          accountId={selectedAccountId}
          configuredTypes={configuredTypes}
          allowExistingConfig={allowExistingConfigInModal}
          allowEditAccountId={allowEditAccountIdInModal}
          existingAccountIds={existingAccountIdsForModal}
          initialConfigValues={initialConfigValuesForModal}
          showChannelName={false}
          onClose={() => {
            setShowConfigModal(false);
            setSelectedChannelType(null);
            setSelectedAccountId(undefined);
            setAllowExistingConfigInModal(true);
            setAllowEditAccountIdInModal(false);
            setExistingAccountIdsForModal([]);
            setInitialConfigValuesForModal(undefined);
          }}
          onChannelSaved={async () => {
            await fetchPageData();
            setShowConfigModal(false);
            setSelectedChannelType(null);
            setSelectedAccountId(undefined);
            setAllowExistingConfigInModal(true);
            setAllowEditAccountIdInModal(false);
            setExistingAccountIdsForModal([]);
            setInitialConfigValuesForModal(undefined);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common:actions.confirm')}
        message={deleteTarget?.accountId ? t('account.deleteConfirm') : t('deleteConfirm')}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[22px] h-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[22px] h-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[22px] h-[22px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[22px] h-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[22px] h-[22px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[22px] h-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

export default Channels;
