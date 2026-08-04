import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { RefreshCw, Trash2, AlertCircle, Check, ChevronDown, Info, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { DingTalkHubBindModal } from '@/components/channels/DingTalkHubBindModal';
import { MobileAppConfigModal } from '@/components/channels/MobileAppConfigModal';
import { Switch } from '@/components/ui/switch';
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
  type ChannelType,
} from '@/types/channel';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { isProjectAgentId } from '../../../shared/project-agent';

import telegramIcon from '@/assets/channels/telegram.svg?raw';
import discordIcon from '@/assets/channels/discord.svg?raw';
import whatsappIcon from '@/assets/channels/whatsapp.svg?raw';
import wechatIcon from '@/assets/channels/wechat.svg?raw';
import dingtalkIcon from '@/assets/channels/dingtalk.svg?raw';
import wecomIcon from '@/assets/channels/wecom.svg?raw';
import qqIcon from '@/assets/channels/qq.svg?raw';
import sclawAppLogo from '@/assets/logo.png';

/** 各频道品牌色：绑定成功后图标点亮用 */
const CHANNEL_BRAND_COLOR: Partial<Record<ChannelType, string>> = {
  dingtalk: '#0089FF',
  wechat: '#07C160',
  wecom: '#2B7BD6',
  qqbot: '#12B7F5',
  telegram: '#2AABEE',
  discord: '#5865F2',
  whatsapp: '#25D366',
};

/** 移动端 App 品牌色（小龙虾橙） */
const MOBILE_APP_BRAND_COLOR = '#FF6A00';

const CHANNEL_ICON_RAW: Partial<Record<ChannelType, string>> = {
  telegram: telegramIcon,
  discord: discordIcon,
  whatsapp: whatsappIcon,
  wechat: wechatIcon,
  dingtalk: dingtalkIcon,
  wecom: wecomIcon,
  qqbot: qqIcon,
};

function tintChannelSvg(raw: string, color: string): string {
  return raw
    .replace(/<\?xml[\s\S]*?\?>/i, '')
    .replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/\sfill="[^"]*"/gi, '')
    .replace(/<svg\b/i, `<svg fill="${color}"`)
    .replace(/\s(width|height)="[^"]*"/gi, '');
}

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

/** 频道行图标按钮：中性悬停底，与删除成组时用 gap-0.5 */
const channelIconBtnClass = cn(
  'h-8 w-8 shrink-0 rounded-md text-[#86909C] shadow-none',
  'hover:bg-[#F2F3F5] hover:text-[#1D2129]',
  'dark:text-muted-foreground dark:hover:bg-white/[0.08] dark:hover:text-foreground',
);

const channelDeleteIconBtnClass = cn(
  'h-8 w-8 shrink-0 rounded-md text-[#86909C] shadow-none',
  'hover:bg-destructive/10 hover:text-destructive',
  'dark:text-muted-foreground',
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
    /** Hub 本机绑定状态 */
    bindStatus?: string | null;
    /** 被其他设备抢走时的提示（打开频道页时展示在条目副文案） */
    replaceHint?: 'other_device' | 'unbound' | null;
  } | null>(null);
  const [mobileBinding, setMobileBinding] = useState<{
    enabled: boolean;
    /** 是否已完成过绑定确认（关闭开关后仍为 true，用于展示「配置」） */
    configured: boolean;
    engineType: 'claude' | 'openclaw';
    agentId: string | null;
    wsConnected: boolean;
    canConnectWs: boolean;
  } | null>(null);
  const [mobileToggleBusy, setMobileToggleBusy] = useState(false);
  const [sessionIdleEnabled, setSessionIdleEnabled] = useState(true);
  const [sessionIdleHours, setSessionIdleHours] = useState(24);
  const [sessionIdleBusy, setSessionIdleBusy] = useState(false);
  /** 切换引擎后若当前 Agent 不兼容，先本地记下引擎，等用户显式选 Agent 再保存 */
  const [pendingDingTalkEngine, setPendingDingTalkEngine] = useState<'claude' | 'openclaw' | null>(
    null,
  );  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showDingTalkHubModal, setShowDingTalkHubModal] = useState(false);
  const [showMobileConfigModal, setShowMobileConfigModal] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [allowExistingConfigInModal, setAllowExistingConfigInModal] = useState(true);
  const [allowEditAccountIdInModal, setAllowEditAccountIdInModal] = useState(false);
  const [existingAccountIdsForModal, setExistingAccountIdsForModal] = useState<string[]>([]);
  const [initialConfigValuesForModal, setInitialConfigValuesForModal] = useState<Record<string, string> | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const fetchPageData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [channelsRes, agentsRes, dingTalkStatusRes, mobileStatusRes, settingsRes] = await Promise.all([
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
      ]);

      if (!channelsRes.success) {
        throw new Error(channelsRes.error || 'Failed to load channels');
      }

      if (!agentsRes.success) {
        throw new Error(agentsRes.error || 'Failed to load agents');
      }

      setChannelGroups(channelsRes.channels || []);
      setAgents((agentsRes.agents || []).filter((agent) => !isProjectAgentId(agent.id)));
      if (settingsRes) {
        setSessionIdleEnabled(settingsRes.channelSessionIdleEnabled !== false);
        const hours = Number(settingsRes.channelSessionIdleHours);
        setSessionIdleHours(Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.floor(hours))) : 24);
      }

      const local = dingTalkStatusRes?.success ? dingTalkStatusRes.local : null;
      const remote = dingTalkStatusRes?.success ? dingTalkStatusRes.remote : null;
      const localDeviceId = dingTalkStatusRes?.success ? dingTalkStatusRes.deviceId : undefined;
      const engineType =
        local?.engineType === 'openclaw' || local?.engineType === 'claude'
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
      setMobileBinding({
        enabled: mobileEnabled,
        configured: mobileConfigured,
        engineType: mobileLocal?.engineType === 'openclaw' ? 'openclaw' : 'claude',
        agentId: mobileLocal?.agentId ?? 'main',
        wsConnected: Boolean(mobileStatusRes?.ws?.connected),
        canConnectWs: Boolean(mobileStatusRes?.canConnectWs),
      });
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
    const order: ChannelType[] = ['dingtalk', 'wechat', 'wecom', 'qqbot'];
    const items: ChannelListItem[] = [];
    const used = new Set<string>();

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
        used.add(group.channelType);
      } else {
        items.push({ kind: 'available', type, recommended: type === 'dingtalk' });
      }
    }

    for (const group of channelGroups) {
      if (used.has(group.channelType)) continue;
      if (
        group.channelType === 'wechat'
        || group.channelType === 'openclaw-weixin'
        || group.channelType === 'dingtalk'
        || group.channelType === 'wecom'
        || group.channelType === 'qqbot'
      ) {
        continue;
      }
      items.push({ kind: 'configured', group });
    }

    return items;
  }, [channelGroups, groupedByType]);

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
      toast.success(
        enabled
          ? t('hub.mobile.enableSuccess')
          : t('hub.mobile.disableSuccess'),
      );
    } catch (toggleError) {
      toast.error(
        t('hub.mobile.toggleFailed', { error: String(toggleError) }),
      );
    } finally {
      setMobileToggleBusy(false);
    }
  };

  const handleMobileBindingChange = async (next: {
    engineType: 'claude' | 'openclaw';
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
    const prev = sessionIdleHours;
    setSessionIdleHours(next);
    if (next === prev) return;
    try {
      await persistSessionIdle({ channelSessionIdleHours: next });
    } catch {
      setSessionIdleHours(prev);
    }
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
            {(() => {
              const resolveAgentEngine = (agent: AgentItem): 'claude' | 'openclaw' =>
                agent.engineType === 'claude' ? 'claude' : 'openclaw';
              const mobileEngine = mobileBinding?.engineType === 'openclaw' ? 'openclaw' : 'claude';
              const mainAgent = agents.find((agent) => agent.id === 'main');
              const engineMatched = agents.filter(
                (agent) => resolveAgentEngine(agent) === mobileEngine,
              );
              const mobileAgentOptions =
                engineMatched.length > 0
                  ? engineMatched
                  : mobileEngine === 'claude' && mainAgent
                    ? [mainAgent]
                    : engineMatched;
              const mobileSelectedAgentId = mobileAgentOptions.some(
                (agent) => agent.id === mobileBinding?.agentId,
              )
                ? mobileBinding?.agentId || mobileAgentOptions[0]?.id
                : mobileAgentOptions[0]?.id;
              const mobileEnabled = Boolean(mobileBinding?.enabled);
              const mobileConfigured = Boolean(mobileBinding?.configured);
              const outlineBtnClass =
                'h-8 shrink-0 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]';

              return (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border',
                        mobileEnabled
                          ? 'border-transparent'
                          : 'border-[#E5E6EB] bg-[#F7F8FA] dark:border-border dark:bg-muted/40',
                      )}
                      style={
                        mobileEnabled
                          ? {
                              backgroundColor: `${MOBILE_APP_BRAND_COLOR}1A`,
                              borderColor: `${MOBILE_APP_BRAND_COLOR}40`,
                            }
                          : undefined
                      }
                    >
                      <img
                        src={sclawAppLogo}
                        alt=""
                        className={cn(
                          'h-[22px] w-[22px] object-contain',
                          !mobileEnabled && 'grayscale opacity-45',
                        )}
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                        {t('hub.mobile.title')}
                      </h3>
                      <p className="mt-0.5 truncate text-[12px] text-[#86909C] dark:text-muted-foreground">
                        {t('hub.mobile.cardDesc', {
                          defaultValue: '通过移动端操作本地 agent',
                        })}
                      </p>
                      {mobileEnabled && !mobileBinding?.wsConnected ? (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                          {t('hub.mobile.hubOfflineHint')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
                    {mobileEnabled ? (
                      <>
                        <ChannelInlineSelect
                          className="w-[120px]"
                          value={mobileEngine}
                          ariaLabel={t('hub.mobile.engineLabel')}
                          options={[
                            { value: 'claude', label: 'Claude' },
                            { value: 'openclaw', label: 'OpenClaw' },
                          ]}
                          onChange={(nextValue) => {
                            const nextEngine = nextValue === 'openclaw' ? 'openclaw' : 'claude';
                            const matched = agents.filter(
                              (agent) => resolveAgentEngine(agent) === nextEngine,
                            );
                            const fallbackMain =
                              nextEngine === 'claude'
                                ? agents.find((agent) => agent.id === 'main')
                                : undefined;
                            const options =
                              matched.length > 0 ? matched : fallbackMain ? [fallbackMain] : [];
                            const nextAgentId =
                              options.find((agent) => agent.id === mobileBinding?.agentId)?.id
                              || options[0]?.id
                              || '';
                            if (!nextAgentId) {
                              toast.error(t('hub.mobile.noAgentsForEngine'));
                              return;
                            }
                            void handleMobileBindingChange({
                              engineType: nextEngine,
                              agentId: nextAgentId,
                            });
                          }}
                        />
                        <ChannelInlineSelect
                          className="w-[140px]"
                          value={mobileSelectedAgentId || ''}
                          ariaLabel={t('hub.mobile.agentLabel')}
                          options={mobileAgentOptions.map((agent) => ({
                            value: agent.id,
                            label: agent.name,
                          }))}
                          onChange={(nextAgentId) => {
                            if (!nextAgentId) return;
                            void handleMobileBindingChange({
                              engineType: mobileEngine,
                              agentId: nextAgentId,
                            });
                          }}
                        />
                        <Switch
                          size="compact"
                          checked
                          disabled={mobileToggleBusy || loading}
                          onCheckedChange={(checked) => {
                            if (!checked) {
                              void handleMobileToggle(false);
                            }
                          }}
                          aria-label={t('hub.mobile.toggleLabel')}
                        />
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className={outlineBtnClass}
                        disabled={mobileToggleBusy || loading}
                        onClick={() => setShowMobileConfigModal(true)}
                      >
                        {mobileConfigured
                          ? t('hub.mobile.configure', { defaultValue: '配置' })
                          : t('account.bind', { defaultValue: '绑定' })}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}
          </section>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold tracking-tight text-[#1D2129] dark:text-foreground">
            {t('supportedChannels')}
          </h2>
          <div className="flex flex-col gap-3">
            {channelListItems.map((item) => {
            if (item.kind === 'configured') {
              const group = item.group;

                        const isDingTalk = group.channelType === 'dingtalk';
                        const isWeChat = group.channelType === 'openclaw-weixin' || group.channelType === 'wechat';
                        const primaryAccount =
                          group.accounts.find((account) => account.isDefault) || group.accounts[0];
                        const weChatAccount = isWeChat ? primaryAccount : undefined;
                        const pluginAccount = !isDingTalk && !isWeChat ? primaryAccount : undefined;
                        const boundAgentId =
                          (isDingTalk ? dingTalkBinding?.agentId : null) ||
                          (isWeChat ? weChatAccount?.agentId : null) ||
                          pluginAccount?.agentId ||
                          group.accounts.find((account) => account.agentId)?.agentId;
                        const boundAgent = boundAgentId
                          ? agents.find((agent) => agent.id === boundAgentId)
                          : undefined;
                        const boundEngineType = isWeChat
                          ? 'openclaw'
                          : (isDingTalk ? dingTalkBinding?.engineType : null) ||
                            boundAgent?.engineType ||
                            null;
                        const resolveAgentEngine = (agent: AgentItem): 'claude' | 'openclaw' =>
                          agent.engineType === 'claude' ? 'claude' : 'openclaw';
                        const dingTalkEngine: 'claude' | 'openclaw' =
                          boundEngineType === 'openclaw' ? 'openclaw' : 'claude';
                        const mainAgent = agents.find((agent) => agent.id === 'main');
                        const engineMatchedAgents = agents.filter(
                          (agent) => resolveAgentEngine(agent) === dingTalkEngine,
                        );
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

                        const weChatDisplayName = weChatAccount
                          ? weChatAccount.accountId === 'default' && weChatAccount.name === weChatAccount.accountId
                            ? t('account.mainAccount')
                            : weChatAccount.name
                          : null;

                        const pluginDisplayName = pluginAccount
                          ? pluginAccount.accountId === 'default' && pluginAccount.name === pluginAccount.accountId
                            ? t('account.mainAccount')
                            : pluginAccount.name
                          : null;

                        const openPrimaryAccountEdit = (account: typeof primaryAccount | undefined) => {
                          if (!account) {
                            setSelectedChannelType(
                              (group.channelType === 'openclaw-weixin' ? 'wechat' : group.channelType) as ChannelType,
                            );
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
                              }>(
                                `/api/channels/config/${encodeURIComponent(group.channelType)}${accountParam}`,
                              );
                              setInitialConfigValuesForModal(
                                result.success ? result.values || {} : undefined,
                              );
                            } catch {
                              setInitialConfigValuesForModal(undefined);
                            }
                            setSelectedChannelType(
                              (group.channelType === 'openclaw-weixin' ? 'wechat' : group.channelType) as ChannelType,
                            );
                            setSelectedAccountId(account.accountId);
                            setAllowExistingConfigInModal(true);
                            setAllowEditAccountIdInModal(false);
                            setExistingAccountIdsForModal([]);
                            setShowConfigModal(true);
                          })();
                        };

                        const channelSubtitle =
                          isDingTalk && dingTalkBinding?.replaceHint === 'other_device'
                            ? t('hub.dingtalk.replacedByOtherDevice')
                            : isDingTalk && dingTalkBinding?.replaceHint === 'unbound'
                              ? t('hub.dingtalk.replacedUnbound')
                              : isDingTalk && dingTalkBinding?.bindStatus !== 'bound'
                                ? t('hub.dingtalk.notBoundHint', {
                                    defaultValue: '未绑定，点击扫码绑定',
                                  })
                                : isDingTalk
                                  ? t('hub.dingtalk.boundStatusHint', {
                                      defaultValue: '已绑定',
                                    })
                                  : isWeChat
                                    ? weChatAccount
                                      ? weChatDisplayName || t('hub.dingtalk.boundStatusHint', {
                                          defaultValue: '已绑定',
                                        })
                                      : t('account.bindingStatus.unbound')
                                    : pluginAccount
                                      ? pluginDisplayName || t('hub.dingtalk.boundStatusHint', {
                                          defaultValue: '已绑定',
                                        })
                                      : t('account.bindingStatus.unbound');

                        const logoType = (
                          group.channelType === 'openclaw-weixin'
                            ? 'wechat'
                            : group.channelType
                        ) as ChannelType;
                        const channelActive = isDingTalk
                          ? dingTalkBinding?.bindStatus === 'bound'
                          : isWeChat
                            ? Boolean(weChatAccount)
                            : Boolean(pluginAccount);

                        return (
                          <section key={group.channelType} className={stoSettingsSectionCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <ChannelIconBubble type={logoType} active={channelActive}>
                                  <ChannelLogo type={logoType} active={channelActive} />
                                </ChannelIconBubble>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                                      {group.channelType === 'openclaw-weixin'
                                        ? CHANNEL_NAMES.wechat
                                        : CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType}
                                    </h3>
                                    {item.recommended ? (
                                      <Badge
                                        variant="secondary"
                                        className="rounded px-1.5 py-0 text-[10px] font-medium border-0 bg-[#FFF7E8] text-[#FF7D00] shadow-none dark:bg-orange-500/15 dark:text-orange-300"
                                      >
                                        {t('recommendedBadge', { defaultValue: '推荐' })}
                                      </Badge>
                                    ) : null}
                                    <div className={channelStatusDotClass(group.status)} />
                                  </div>
                                  <p className="mt-0.5 truncate text-[12px] text-[#86909C] dark:text-muted-foreground">
                                    {channelSubtitle}
                                  </p>
                                  {isWeChat && weChatAccount?.lastError ? (
                                    <p className="mt-1 text-[12px] text-destructive">{weChatAccount.lastError}</p>
                                  ) : null}
                                  {pluginAccount?.lastError ? (
                                    <p className="mt-1 text-[12px] text-destructive">{pluginAccount.lastError}</p>
                                  ) : null}
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
                                  </>
                                ) : isWeChat ? (
                                  <>
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
                                    <ChannelInlineSelect
                                      className="w-[140px]"
                                      value={weChatAccount?.agentId || ''}
                                      ariaLabel={t('account.bindAgentLabel')}
                                      options={[
                                        { value: '', label: t('account.unassigned') },
                                        ...agents.map((agent) => ({
                                          value: agent.id,
                                          label: agent.name,
                                        })),
                                      ]}
                                      onChange={(nextAgentId) => {
                                        if (!weChatAccount) return;
                                        void handleBindAgent(
                                          group.channelType,
                                          weChatAccount.accountId,
                                          nextAgentId,
                                        );
                                      }}
                                    />
                                  </>
                                ) : (
                                  <ChannelInlineSelect
                                    className="w-[140px]"
                                    value={pluginAccount?.agentId || ''}
                                    ariaLabel={t('account.bindAgentLabel')}
                                    options={[
                                      { value: '', label: t('account.unassigned') },
                                      ...agents.map((agent) => ({
                                        value: agent.id,
                                        label: agent.name,
                                      })),
                                    ]}
                                    onChange={(nextAgentId) => {
                                      if (!pluginAccount) return;
                                      void handleBindAgent(
                                        group.channelType,
                                        pluginAccount.accountId,
                                        nextAgentId,
                                      );
                                    }}
                                  />
                                )}
                                <div className="flex items-center gap-0.5">
                                  {isDingTalk ? (
                                    dingTalkBinding?.bindStatus === 'bound' ? (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className={channelIconBtnClass}
                                        onClick={openDingTalkHub}
                                        title={t('account.edit')}
                                        aria-label={t('account.edit')}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
                                        onClick={openDingTalkHub}
                                      >
                                        {t('account.bind', { defaultValue: '绑定' })}
                                      </Button>
                                    )
                                  ) : isWeChat ? (
                                    weChatAccount ? (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className={channelIconBtnClass}
                                        onClick={() => openPrimaryAccountEdit(weChatAccount)}
                                        title={t('account.edit')}
                                        aria-label={t('account.edit')}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
                                        onClick={() => openPrimaryAccountEdit(undefined)}
                                      >
                                        {t('account.bind', { defaultValue: '绑定' })}
                                      </Button>
                                    )
                                  ) : pluginAccount ? (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className={channelIconBtnClass}
                                      onClick={() => openPrimaryAccountEdit(pluginAccount)}
                                      title={t('account.edit')}
                                      aria-label={t('account.edit')}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
                                      onClick={() => openPrimaryAccountEdit(undefined)}
                                    >
                                      {t('account.bind', { defaultValue: '绑定' })}
                                    </Button>
                                  )}
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className={channelDeleteIconBtnClass}
                                    onClick={() => setDeleteTarget({ channelType: group.channelType })}
                                    title={t('account.deleteChannel')}
                                    aria-label={t('account.deleteChannel')}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </section>
                        );
            }

            const type = item.type;
            const meta = CHANNEL_META[type];
            const openAvailable = () => {
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
            };
            return (
              <section
                key={`available-${type}`}
                className={stoSettingsSectionCardClass}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <ChannelIconBubble type={type} active={false}>
                      <ChannelLogo type={type} active={false} />
                    </ChannelIconBubble>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                          {meta.name}
                        </h3>
                        {item.recommended ? (
                          <Badge
                            variant="secondary"
                            className="rounded px-1.5 py-0 text-[10px] font-medium border-0 bg-[#FFF7E8] text-[#FF7D00] shadow-none dark:bg-orange-500/15 dark:text-orange-300"
                          >
                            {t('recommendedBadge', { defaultValue: '推荐' })}
                          </Badge>
                        ) : null}
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
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
                    onClick={openAvailable}
                  >
                    {t('account.bind', { defaultValue: '绑定' })}
                  </Button>
                </div>
              </section>
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
                    defaultValue: '超过设定时间未对话，自动开启新对话（钉钉等平台频道）',
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
                        '开启后，长时间未活跃的历史上下文将不再发送给模型，有效降低 Token 消耗并提升响应速度。',
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

function ChannelLogo({ type, active = false }: { type: ChannelType; active?: boolean }) {
  const raw = CHANNEL_ICON_RAW[type];
  const brand = CHANNEL_BRAND_COLOR[type] ?? '#86909C';
  const label = CHANNEL_NAMES[type] || type;
  const fill = active ? brand : '#C9CDD4';

  if (!raw) {
    return (
      <span
        className={cn('text-[22px] leading-none', !active && 'grayscale opacity-45')}
        aria-hidden
      >
        {CHANNEL_ICONS[type] || '💬'}
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full"
      dangerouslySetInnerHTML={{ __html: tintChannelSvg(raw, fill) }}
    />
  );
}

function ChannelIconBubble({
  type,
  active = false,
  children,
}: {
  type?: ChannelType;
  active?: boolean;
  children?: ReactNode;
}) {
  const brand = type ? CHANNEL_BRAND_COLOR[type] : undefined;
  return (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border',
        active && brand
          ? 'border-transparent'
          : 'border-[#E5E6EB] bg-[#F7F8FA] dark:border-border dark:bg-muted/40',
      )}
      style={
        active && brand
          ? {
              backgroundColor: `${brand}1A`,
              borderColor: `${brand}40`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export default Channels;
