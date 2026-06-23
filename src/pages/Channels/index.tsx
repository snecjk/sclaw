import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Trash2, AlertCircle, Plus, MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { cn } from '@/lib/utils';
import { glassNestedCard, glassNestedInsetRow, glassSectionSurface, stoMainInnerShell } from '@/lib/surfaces';
import { Select } from '@/components/ui/select';
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
}

interface DeleteTarget {
  channelType: string;
  accountId?: string;
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

export function Channels() {
  const { t } = useTranslation('channels');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const lastGatewayStateRef = useRef(gatewayStatus.state);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
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
      const [channelsRes, agentsRes] = await Promise.all([
        hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[]; error?: string }>('/api/channels/accounts'),
        hostApiFetch<{ success: boolean; agents?: AgentItem[]; error?: string }>('/api/agents'),
      ]);

      if (!channelsRes.success) {
        throw new Error(channelsRes.error || 'Failed to load channels');
      }

      if (!agentsRes.success) {
        throw new Error(agentsRes.error || 'Failed to load agents');
      }

      setChannelGroups(channelsRes.channels || []);
      setAgents(agentsRes.agents || []);
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

  const handleBindAgent = async (channelType: string, accountId: string, agentId: string) => {
    try {
      if (!agentId) {
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
      const suffix = deleteTarget.accountId
        ? `?accountId=${encodeURIComponent(deleteTarget.accountId)}`
        : '';
      await hostApiFetch(`/api/channels/config/${encodeURIComponent(deleteTarget.channelType)}${suffix}`, {
        method: 'DELETE',
      });
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
      <div className={cn(stoMainInnerShell, 'flex flex-col pb-10')}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(stoMainInnerShell, 'flex flex-col gap-8 pb-10')}>
      <header className="shrink-0 border-b border-border pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-primary/[0.08] text-primary shadow-[0_8px_24px_rgba(255,111,0,0.10)]">
              <MessagesSquare className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.65rem]">
                {t('title')}
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {t('subtitle')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5">
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={gatewayStatus.state !== 'running'}
              className="h-9 rounded-md border-glass-border bg-transparent px-4 text-[13px] font-medium shadow-none hover:bg-[hsl(var(--glass-bg)/0.35)]"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('refresh')}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        {gatewayStatus.state !== 'running' && (
          <div className="flex items-center gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
              {t('gatewayWarning')}
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <span className="text-sm font-medium text-destructive">{error}</span>
          </div>
        )}

        {configuredGroups.length > 0 && (
          <section className={glassSectionSurface}>
            <h2 className="mb-5 text-lg font-semibold tracking-tight text-foreground">
              {t('configured')}
            </h2>
            <div className="space-y-3">
              {configuredGroups.map((group) => (
                  <div
                    key={group.channelType}
                    className={cn(
                      'rounded-md border border-border p-4 transition-all duration-200 hover:border-border hover:shadow-md',
                      glassNestedCard,
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-[40px] w-[40px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                          <ChannelLogo type={group.channelType as ChannelType} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-[16px] font-semibold text-foreground truncate">
                            {CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType}
                          </h3>
                          <p className="text-[12px] text-muted-foreground">{group.channelType}</p>
                        </div>
                        <div
                          className={cn(
                            'w-2 h-2 rounded-full shrink-0',
                            group.status === 'connected'
                              ? 'bg-green-500'
                              : group.status === 'connecting'
                                ? 'bg-yellow-500 animate-pulse'
                                : group.status === 'error'
                                  ? 'bg-destructive'
                                  : 'bg-muted-foreground'
                          )}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-md border-glass-border text-xs"
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
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          {t('account.add')}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget({ channelType: group.channelType })}
                          title={t('account.deleteChannel')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {group.accounts.map((account) => {
                        const displayName =
                          account.accountId === 'default' && account.name === account.accountId
                            ? t('account.mainAccount')
                            : account.name;
                        return (
                        <div
                          key={`${group.channelType}-${account.accountId}`}
                          className={cn('rounded-md px-3 py-2', glassNestedInsetRow)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-[13px] font-medium text-foreground truncate">{displayName}</p>
                              </div>
                              {account.lastError && (
                                <div className="text-[12px] text-destructive mt-1">{account.lastError}</div>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{t('account.bindAgentLabel')}</span>
                              <Select
                                className="h-8 min-h-8 max-w-[200px] py-0 text-xs"
                                value={account.agentId || ''}
                                onChange={(event) => {
                                  void handleBindAgent(group.channelType, account.accountId, event.target.value);
                                }}
                              >
                                <option value="">{t('account.unassigned')}</option>
                                {agents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>
                                    {agent.name}
                                  </option>
                                ))}
                              </Select>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-md border-glass-border text-xs"
                                  onClick={() => {
                                    void (async () => {
                                      try {
                                        const accountParam = `?accountId=${encodeURIComponent(account.accountId)}`;
                                        const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
                                          `/api/channels/config/${encodeURIComponent(group.channelType)}${accountParam}`
                                        );
                                        setInitialConfigValuesForModal(result.success ? (result.values || {}) : undefined);
                                      } catch {
                                        // Fall back to modal-side loading when prefetch fails.
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
                                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteTarget({ channelType: group.channelType, accountId: account.accountId })}
                                title={t('account.delete')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
          </section>
        )}

          <section className={glassSectionSurface}>
            <h2 className="mb-5 text-lg font-semibold tracking-tight text-foreground">
              {t('supportedChannels')}
            </h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-6 md:gap-y-3">
              {unsupportedGroups.map((type) => {
                const meta = CHANNEL_META[type];
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedChannelType(type);
                      setSelectedAccountId(undefined);
                      setAllowExistingConfigInModal(true);
                      setAllowEditAccountIdInModal(false);
                      setExistingAccountIdsForModal([]);
                      setInitialConfigValuesForModal(undefined);
                      setShowConfigModal(true);
                    }}
                    className={cn(
                      'group relative flex items-center gap-4 rounded-md border border-border p-4 text-left transition-all duration-200 hover:border-border hover:shadow-md',
                      glassNestedCard,
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 bg-primary/[0.06] text-foreground shadow-sm dark:border-white/10">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[16px] font-semibold text-foreground truncate">{meta.name}</h3>
                        {meta.isPlugin && (
                          <Badge variant="secondary" className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
                        {t(meta.description.replace('channels:', ''))}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
      </div>

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
        title={t('common.confirm', 'Confirm')}
        message={deleteTarget?.accountId ? t('account.deleteConfirm') : t('deleteConfirm')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
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
