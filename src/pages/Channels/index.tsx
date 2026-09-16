import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, AlertCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { Switch } from '@/components/ui/switch';
import { stoSettingsSectionCardClass } from '@/lib/surfaces';
import type { ChannelType } from '@/types/channel';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  getAgentEnginePolicyOptionLabel,
  useAgentEnginePolicyStore,
} from '@/stores/agent-engine-policy';
import { useAuthStore } from '@/stores/auth';
import type { AgentEngineType } from '../../../shared/agent-engine';
import { isProjectAgentId } from '../../../shared/project-agent';

import { AvailableChannelRow } from './AvailableChannelRow';
import { ChannelConfigModal } from './ChannelConfigModal';
import { ConfiguredChannelRow } from './ConfiguredChannelRow';
import { DingTalkHubBindModal } from './DingTalkHubBindModal';
import { MobileAppChannelRow } from './MobileAppChannelRow';
import { MobileAppConfigModal } from './MobileAppConfigModal';
import { normalizeLogoType, removeDeletedTarget, toBindingEngine } from './helpers';
import type {
  AgentItem,
  ChannelAccountItem,
  ChannelGroupItem,
  DeleteTarget,
  DingTalkBindingState,
  MobileBindingState,
} from './types';

export function Channels() {
  const { t } = useTranslation(['channels', 'common']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const lastGatewayStateRef = useRef(gatewayStatus.state);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [dingTalkBinding, setDingTalkBinding] = useState<DingTalkBindingState>(null);
  const [mobileBinding, setMobileBinding] = useState<MobileBindingState>(null);
  const [mobileToggleBusy, setMobileToggleBusy] = useState(false);
  const [sessionIdleEnabled, setSessionIdleEnabled] = useState(true);
  const [sessionIdleHours, setSessionIdleHours] = useState(24);
  const [sessionIdleBusy, setSessionIdleBusy] = useState(false);
  /** Last value successfully persisted; blur commit must compare against this, not live input state. */
  const persistedSessionIdleHoursRef = useRef(24);
  /** 切换引擎后若当前 Agent 不兼容，先本地记下引擎，等用户显式选 Agent 再保存 */
  const [, setPendingDingTalkEngine] = useState<AgentEngineType | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showDingTalkHubModal, setShowDingTalkHubModal] = useState(false);
  const [showMobileConfigModal, setShowMobileConfigModal] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [allowExistingConfigInModal, setAllowExistingConfigInModal] = useState(true);
  const [allowEditAccountIdInModal, setAllowEditAccountIdInModal] = useState(false);
  const [existingAccountIdsForModal, setExistingAccountIdsForModal] = useState<string[]>([]);
  const [initialConfigValuesForModal, setInitialConfigValuesForModal] = useState<Record<string, string> | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const authUserKey = useAuthStore((state) => (
    state.user?.code || state.user?.empCode || state.user?.id || ''
  ));
  const policyEngines = useAgentEnginePolicyStore((state) => state.engines);
  const fetchEnginePolicy = useAgentEnginePolicyStore((state) => state.fetchPolicy);
  const channelEngineOptions = useMemo(
    () => policyEngines.map((engine) => ({
      value: engine.code,
      label: getAgentEnginePolicyOptionLabel(engine),
    })),
    [policyEngines],
  );

  const fetchPageData = useCallback(() => {
    void Promise.all([
      hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[]; error?: string }>('/api/channels/accounts'),
      hostApiFetch<{ success: boolean; agents?: AgentItem[]; error?: string }>('/api/agents'),
      hostApiFetch<{
        success: boolean;
        local?: {
          engineType?: string | null;
          agentId?: string | null;
          bindStatus?: string | null;
        } | null;
        remote?: { bound?: boolean; deviceId?: string; error?: string } | null;
        deviceId?: string;
      }>('/api/channels/hub/dingtalk/status').catch(() => null),
      hostApiFetch<{
        success: boolean;
        local?: {
          bindStatus?: string | null;
          engineType?: string | null;
          agentId?: string | null;
          enabled?: boolean;
        } | null;
        ws?: { connected?: boolean };
        canConnectWs?: boolean;
      }>('/api/channels/hub/mobile/status').catch(() => null),
      hostApiFetch<{
        channelSessionIdleEnabled?: boolean;
        channelSessionIdleHours?: number;
      }>('/api/settings').catch(() => null),
    ]).then(([
      channelsRes,
      agentsRes,
      dingTalkStatusRes,
      mobileStatusRes,
      settingsRes,
    ]) => {
      if (!channelsRes.success) {
        throw new Error(channelsRes.error || 'Failed to load channels');
      }

      if (!agentsRes.success) {
        throw new Error(agentsRes.error || 'Failed to load agents');
      }

      setError(null);
      setChannelGroups(channelsRes.channels || []);
      setAgents((agentsRes.agents || []).filter((agent) => !isProjectAgentId(agent.id)));
      if (settingsRes) {
        setSessionIdleEnabled(settingsRes.channelSessionIdleEnabled !== false);
        const hours = Number(settingsRes.channelSessionIdleHours);
        const clampedHours = Number.isFinite(hours)
          ? Math.min(168, Math.max(1, Math.floor(hours)))
          : 24;
        setSessionIdleHours(clampedHours);
        persistedSessionIdleHoursRef.current = clampedHours;
      }

      const local = dingTalkStatusRes?.success ? dingTalkStatusRes.local : null;
      const remote = dingTalkStatusRes?.success ? dingTalkStatusRes.remote : null;
      const localDeviceId = dingTalkStatusRes?.success ? dingTalkStatusRes.deviceId : undefined;
      const engineType =
        local?.engineType === 'openclaw' || local?.engineType === 'claude' || local?.engineType === 'pi'
          ? local.engineType
          : null;
      let replaceHint: 'other_device' | 'unbound' | null = null;
      const remoteOk = Boolean(remote && !('error' in remote && remote.error));
      if (remoteOk && remote) {
        if (remote.bound === false) {
          replaceHint = 'unbound';
        } else if (
          remote.bound
          && remote.deviceId
          && localDeviceId
          && remote.deviceId !== localDeviceId
        ) {
          replaceHint = 'other_device';
        }
      }
      setDingTalkBinding(
        local
          ? {
              engineType,
              agentId: local.agentId ?? null,
              bindStatus: local.bindStatus ?? null,
              replaceHint,
            }
          : null,
      );
      setPendingDingTalkEngine(null);
      const mobileLocal = mobileStatusRes?.success ? mobileStatusRes.local : null;
      const mobileBound = mobileLocal?.bindStatus === 'bound';
      const mobileEnabled = Boolean(
        mobileBound && mobileLocal?.enabled !== false,
      );
      const storedConfigured =
        typeof localStorage !== 'undefined'
        && localStorage.getItem('sclaw.mobile.configured') === '1';
      const mobileConfigured = mobileBound || mobileEnabled || storedConfigured;
      if (mobileConfigured && typeof localStorage !== 'undefined') {
        localStorage.setItem('sclaw.mobile.configured', '1');
      }
      const mobileEngineType: AgentEngineType =
        mobileLocal?.engineType === 'openclaw' || mobileLocal?.engineType === 'pi'
          ? mobileLocal.engineType
          : 'claude';
      setMobileBinding({
        enabled: mobileEnabled,
        configured: mobileConfigured,
        engineType: mobileEngineType,
        agentId: mobileLocal?.agentId ?? 'main',
        wsConnected: Boolean(mobileStatusRes?.ws?.connected),
        canConnectWs: Boolean(mobileStatusRes?.canConnectWs),
      });
    }).catch((fetchError: unknown) => {
      setError(String(fetchError));
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  useEffect(() => {
    if (!authUserKey) return;
    void fetchEnginePolicy(authUserKey);
  }, [authUserKey, fetchEnginePolicy]);

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
    const unsubscribe = subscribeHostEvent<{ reason?: string }>(
      'channel:dingtalk-bind-replaced',
      () => {
        void fetchPageData();
      },
    );
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

  type ChannelListItem =
    | { kind: 'configured'; group: ChannelGroupItem; recommended?: boolean }
    | { kind: 'available'; type: ChannelType; recommended?: boolean };

  const channelListItems = useMemo((): ChannelListItem[] => {
    const order: ChannelType[] = ['dingtalk', 'wechat'];
    const items: ChannelListItem[] = [];

    const findGroup = (type: ChannelType): ChannelGroupItem | undefined => {
      if (type === 'wechat') {
        return channelGroups.find(
          (group) => group.channelType === 'wechat' || group.channelType === 'openclaw-weixin',
        );
      }
      return groupedByType[type];
    };

    for (const type of order) {
      const group = findGroup(type);
      if (group) {
        items.push({ kind: 'configured', group, recommended: type === 'dingtalk' });
      } else {
        items.push({ kind: 'available', type, recommended: type === 'dingtalk' });
      }
    }

    return items;
  }, [channelGroups, groupedByType]);

  const handleRefresh = () => {
    void fetchPageData();
  };

  const openDingTalkHub = () => {
    setShowDingTalkHubModal(true);
  };

  const handleWeChatBindingChange = async (next: {
    engineType: AgentEngineType;
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
      await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/wechat/binding/agent', {
        method: 'POST',
        body: JSON.stringify(next),
      });
      await fetchPageData();
      toast.success(t('toast.bindingUpdated'));
    } catch (bindError) {
      toast.error(t('toast.configFailed', { error: String(bindError) }));
    }
  };

  const handleDingTalkBindingChange = async (next: {
    engineType: 'claude' | 'openclaw' | 'pi';
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

  const handleMobileToggle = async (enabled: boolean) => {
    setMobileToggleBusy(true);
    try {
      const path = enabled
        ? '/api/channels/hub/mobile/bind/enable'
        : '/api/channels/hub/mobile/bind/disable';
      await hostApiFetch<{ success: boolean; error?: string }>(path, { method: 'POST' });
      if (enabled && typeof localStorage !== 'undefined') {
        localStorage.setItem('sclaw.mobile.configured', '1');
      }
      await fetchPageData();
      const successKey = enabled ? 'hub.mobile.enableSuccess' : 'hub.mobile.disableSuccess';
      toast.success(t(successKey));
    } catch (toggleError) {
      toast.error(
        t('hub.mobile.toggleFailed', { error: String(toggleError) }),
      );
    } finally {
      setMobileToggleBusy(false);
    }
  };

  const handleMobileBindingChange = async (next: {
    engineType: AgentEngineType;
    agentId: string;
  }) => {
    if (!next.agentId) {
      toast.error(t('hub.mobile.agentRequired'));
      return;
    }
    try {
      await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/hub/mobile/binding/agent', {
        method: 'POST',
        body: JSON.stringify(next),
      });
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
        await handleDingTalkBindingChange({
          engineType: toBindingEngine(agent?.engineType),
          agentId,
        });
        return;
      }
      if (channelType === 'wechat' || channelType === 'openclaw-weixin') {
        const agent = agents.find((item) => item.id === agentId);
        await handleWeChatBindingChange({
          engineType: toBindingEngine(agent?.engineType),
          agentId,
        });
        return;
      }
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

  const persistSessionIdle = async (patch: {
    channelSessionIdleEnabled?: boolean;
    channelSessionIdleHours?: number;
  }) => {
    setSessionIdleBusy(true);
    try {
      await hostApiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
    } catch (err) {
      toast.error(
        t('sessionIdle.saveFailed', {
          defaultValue: '保存失败: {{error}}',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    } finally {
      setSessionIdleBusy(false);
    }
  };

  const handleSessionIdleToggle = async (enabled: boolean) => {
    const prev = sessionIdleEnabled;
    setSessionIdleEnabled(enabled);
    try {
      await persistSessionIdle({ channelSessionIdleEnabled: enabled });
    } catch {
      setSessionIdleEnabled(prev);
    }
  };

  const handleSessionIdleHoursCommit = async (raw: number) => {
    const next = Number.isFinite(raw) ? Math.min(168, Math.max(1, Math.floor(raw))) : 24;
    const prevPersisted = persistedSessionIdleHoursRef.current;
    setSessionIdleHours(next);
    // onChange already wrote the same value into state before blur; compare against last saved.
    if (next === prevPersisted) return;
    try {
      await persistSessionIdle({ channelSessionIdleHours: next });
      persistedSessionIdleHoursRef.current = next;
    } catch {
      setSessionIdleHours(prevPersisted);
    }
  };

  const openConfiguredAccountEdit = (channelType: string, account?: ChannelAccountItem) => {
    const logoType = normalizeLogoType(channelType);
    if (!account) {
      setSelectedChannelType(logoType);
      setSelectedAccountId(undefined);
      setAllowExistingConfigInModal(false);
      setAllowEditAccountIdInModal(false);
      setExistingAccountIdsForModal([]);
      setInitialConfigValuesForModal(undefined);
      setShowConfigModal(true);
      return;
    }
    void (async () => {
      try {
        const accountParam = `?accountId=${encodeURIComponent(account.accountId)}`;
        const result = await hostApiFetch<{
          success: boolean;
          values?: Record<string, string>;
        }>(`/api/channels/config/${encodeURIComponent(channelType)}${accountParam}`);
        setInitialConfigValuesForModal(result.success ? result.values || {} : undefined);
      } catch {
        setInitialConfigValuesForModal(undefined);
      }
      setSelectedChannelType(logoType);
      setSelectedAccountId(account.accountId);
      setAllowExistingConfigInModal(true);
      setAllowEditAccountIdInModal(false);
      setExistingAccountIdsForModal([]);
      setShowConfigModal(true);
    })();
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

        <div className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold tracking-tight text-[#1D2129] dark:text-foreground">
            {t('supportedMobile', { defaultValue: '支持的移动端' })}
          </h2>
          <section className={stoSettingsSectionCardClass}>
            <MobileAppChannelRow
              agents={agents}
              mobileBinding={mobileBinding}
              channelEngineOptions={channelEngineOptions}
              mobileToggleBusy={mobileToggleBusy}
              loading={loading}
              onMobileBindingChange={handleMobileBindingChange}
              onMobileToggle={handleMobileToggle}
              onOpenConfig={() => setShowMobileConfigModal(true)}
            />
          </section>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold tracking-tight text-[#1D2129] dark:text-foreground">
            {t('supportedChannels')}
          </h2>
          <div className="flex flex-col gap-3">
            {channelListItems.map((item) => {
              if (item.kind === 'configured') {
                return (
                  <ConfiguredChannelRow
                    key={item.group.channelType}
                    group={item.group}
                    recommended={item.recommended}
                    agents={agents}
                    dingTalkBinding={dingTalkBinding}
                    channelEngineOptions={channelEngineOptions}
                    onDingTalkBindingChange={handleDingTalkBindingChange}
                    onWeChatBindingChange={handleWeChatBindingChange}
                    onBindAgent={handleBindAgent}
                    onOpenDingTalkHub={openDingTalkHub}
                    onRequestDelete={(channelType) => setDeleteTarget({ channelType })}
                    onOpenAccountEdit={openConfiguredAccountEdit}
                  />
                );
              }

              return (
                <AvailableChannelRow
                  key={`available-${item.type}`}
                  type={item.type}
                  recommended={item.recommended}
                  onOpenDingTalkHub={openDingTalkHub}
                  onOpenConfig={(type) => {
                    setSelectedChannelType(type);
                    setSelectedAccountId(undefined);
                    setAllowExistingConfigInModal(true);
                    setAllowEditAccountIdInModal(false);
                    setExistingAccountIdsForModal([]);
                    setInitialConfigValuesForModal(undefined);
                    setShowConfigModal(true);
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold tracking-tight text-[#1D2129] dark:text-foreground">
            {t('sessionIdle.sectionTitle', { defaultValue: '会话管理' })}
          </h2>
          <section className={stoSettingsSectionCardClass}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                  {t('sessionIdle.title', { defaultValue: '自动新起会话' })}
                </h3>
                <p className="mt-0.5 text-[12px] text-[#86909C] dark:text-muted-foreground">
                  {t('sessionIdle.subtitle', {
                    defaultValue: '超过设定时间未对话后，下次发消息会开新会话（钉钉/微信等；不含 App）',
                  })}
                </p>
              </div>
              <Switch
                size="compact"
                checked={sessionIdleEnabled}
                disabled={sessionIdleBusy || loading}
                onCheckedChange={(checked) => {
                  void handleSessionIdleToggle(checked);
                }}
                aria-label={t('sessionIdle.title', { defaultValue: '自动新起会话' })}
              />
            </div>
            {sessionIdleEnabled ? (
              <div className="mt-4 space-y-3">
                <p className="flex flex-wrap items-center gap-2 text-[13px] text-[#1D2129] dark:text-foreground">
                  <span>{t('sessionIdle.overPrefix', { defaultValue: '超过' })}</span>
                  <Input
                    type="number"
                    min={1}
                    max={168}
                    step={1}
                    value={sessionIdleHours}
                    disabled={sessionIdleBusy || loading}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setSessionIdleHours(n);
                    }}
                    onBlur={() => {
                      void handleSessionIdleHoursCommit(sessionIdleHours);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="h-8 w-16 rounded-md border-[#E5E6EB] px-2 text-center text-[13px] shadow-none dark:border-border"
                    aria-label={t('sessionIdle.hoursLabel', { defaultValue: '空闲小时数' })}
                  />
                  <span>
                    {t('sessionIdle.overSuffix', {
                      defaultValue: '小时未对话，自动开启新会话',
                    })}
                  </span>
                </p>
                <div className="flex items-start gap-2 rounded-[8px] bg-[#F7F8FA] px-3 py-2.5 dark:bg-muted/40">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#86909C]" aria-hidden />
                  <p className="text-[12px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
                    {t('sessionIdle.tip', {
                      defaultValue:
                        '不会后台凭空建会话。超时后对方再发消息时才会新建对话，旧上下文不再带给模型，从而降低 Token 消耗。',
                    })}
                  </p>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {showDingTalkHubModal && (
        <DingTalkHubBindModal
          onClose={() => setShowDingTalkHubModal(false)}
          onChanged={async () => {
            await fetchPageData();
          }}
        />
      )}

      {showMobileConfigModal && (
        <MobileAppConfigModal
          enabled={Boolean(mobileBinding?.enabled)}
          busy={mobileToggleBusy || loading}
          onClose={() => setShowMobileConfigModal(false)}
          onToggle={async (nextEnabled) => {
            await handleMobileToggle(nextEnabled);
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

export default Channels;
