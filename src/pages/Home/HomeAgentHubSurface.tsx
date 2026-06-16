/**
 * 无 CRM 周报策略权限时的首页：Hero + 能力卡片 + 底部输入（色板对齐 docs/sto-design.md）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, ChevronDown, Cpu, Repeat2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { useChatInputBindings } from '@/hooks/use-chat-input-bindings';
import { HomeHero } from './HomeHero';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { useHomeConversationActive } from './use-home-conversation-active';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { toast } from 'sonner';

/** sto-design Grey-10 主标题 / 默认正文 */
const TEXT_PRIMARY = 'text-[#1D2129] dark:text-foreground';
/** sto-design Grey-8 次要 */
const TEXT_SECONDARY = 'text-[#86909C] dark:text-muted-foreground';
/** sto-design Grey-4 边框 */
const BORDER_DEFAULT = 'border-[#E5E6EB] dark:border-border';
/** sto-design Brand-1 浅底、Brand-6 图标主色（申通橙） */
const INFO_ICON_WRAP =
  'bg-[#FFF5E6] text-[#FF6F00] dark:bg-amber-950/45 dark:text-[#FF8D2A]';
/** sto-design Brand-1 + Brand-7 功能角标 */
const TAG_FUNCTION =
  'rounded-md bg-[#FFF5E6] px-2 py-0.5 text-xs font-medium text-[#D95700] dark:bg-amber-950/45 dark:text-amber-200';
/** sto-design Green-6 就绪点 */
const DOT_SUCCESS = 'bg-[#00B54B]';
/** sto-design Brand-6 申通橙 */
const DOT_BRAND = 'bg-[#FF6F00] dark:bg-[#FF8D2A]';

export function HomeAgentHubSurface({ seedText }: { seedText?: string }) {
  const { t } = useTranslation('home');
  const showConversation = useHomeConversationActive();

  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sending = useChatStore((s) => s.sending);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const error = useChatStore((s) => s.error);
  const [engineSaving, setEngineSaving] = useState(false);
  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );
  const currentEngineType = currentSessionKey === DEFAULT_SESSION_KEY
    ? currentAgent?.engineType
    : currentSession?.engineType ?? currentAgent?.engineType;
  const agentDefaultEngineType = currentAgent?.engineType ?? 'openclaw';
  const agentDefaultEngineLabel = agentDefaultEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const gatewayLine = useMemo(() => {
    const port = gatewayStatus.port ?? 18789;
    const pid = gatewayStatus.pid;
    if (gatewayStatus.state === 'running') {
      return t('agentHub.gatewayLineConnected', { port, pid: pid ?? '—' });
    }
    if (gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting') {
      return t('agentHub.gatewayLineConnecting', { port });
    }
    return t('agentHub.gatewayLineDisconnected', { port });
  }, [gatewayStatus.port, gatewayStatus.pid, gatewayStatus.state, t]);

  const { handleHubSend, handleHubQueue } = useHomeChatEntrySend();
  const handleEngineSwitch = async (engineType: 'openclaw' | 'claude') => {
    if (!currentAgentId || engineType === agentDefaultEngineType) return;
    setEngineSaving(true);
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(currentAgentId)}/engine`, {
        method: 'PUT',
        body: JSON.stringify({ engineType }),
      });
      await fetchAgents();
      await loadSessions();
      toast.success(`新会话将使用 ${engineType === 'claude' ? 'Claude Agent' : 'OpenClaw'} 引擎`);
    } catch (err) {
      toast.error(`切换引擎失败: ${String(err)}`);
    } finally {
      setEngineSaving(false);
    }
  };

  const engineSelectDisabled = sending || !currentAgentId;
  const engineAccessory = (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[12px] font-medium text-[#4E5969] dark:text-muted-foreground">
        引擎
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={engineSelectDisabled || engineSaving}>
          <button
            type="button"
            title="切换新会话执行引擎"
            className={cn(
              'inline-flex h-9 min-w-[180px] max-w-full items-center gap-2.5 rounded-full border border-[#E5E6EB] bg-white px-4 text-left shadow-[0_4px_12px_rgba(29,33,41,0.05)] transition-colors',
              'hover:border-[#FFC17A] hover:bg-[#FFF9F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F00]/20',
              'dark:border-border dark:bg-[#131a24] dark:hover:border-[#FFC17A]/90 dark:hover:bg-white/[0.04]',
              (engineSelectDisabled || engineSaving) && 'pointer-events-none opacity-60',
            )}
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {agentDefaultEngineLabel}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="min-w-[12rem]">
          {(['openclaw', 'claude'] as const).map((engineType) => {
            const label = engineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
            const isSelected = agentDefaultEngineType === engineType;
            return (
              <DropdownMenuItem
                key={engineType}
                className={cn('flex items-center gap-2', isSelected && 'bg-primary/8 font-medium')}
                onSelect={() => void handleEngineSwitch(engineType)}
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
                {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 sm:px-6">
        {showConversation ? (
          <HomeMainConversation className="min-h-0 flex-1" />
        ) : (
          <>
            <div className="mx-auto mb-3 mt-2 flex w-full max-w-[960px] justify-start">
              {engineAccessory}
            </div>
            <div className="mx-auto flex min-h-0 w-full max-w-[960px] flex-1 flex-col justify-center gap-10 overflow-y-auto overscroll-y-contain pb-6">
              <HomeHero />

              <div className="grid w-full gap-4 sm:grid-cols-3">
                {(
                  [
                    {
                      icon: Cpu,
                      titleKey: 'agentHub.cardTasksTitle' as const,
                      descKey: 'agentHub.cardTasksDesc' as const,
                    },
                    {
                      icon: Repeat2,
                      titleKey: 'agentHub.cardExecTitle' as const,
                      descKey: 'agentHub.cardExecDesc' as const,
                    },
                    {
                      icon: Bot,
                      titleKey: 'agentHub.cardMultiTitle' as const,
                      descKey: 'agentHub.cardMultiDesc' as const,
                    },
                  ] as const
                ).map(({ icon: Icon, titleKey, descKey }) => (
                  <div
                    key={titleKey}
                    className={cn(
                      'flex flex-col rounded-2xl border bg-white p-5 shadow-[0_4px_20px_rgba(29,33,41,0.06)] dark:bg-card',
                      BORDER_DEFAULT,
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', INFO_ICON_WRAP)}>
                        <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <span className={TAG_FUNCTION}>{t('agentHub.functionTag')}</span>
                        <h3 className={cn('mt-2 text-base font-semibold', TEXT_PRIMARY)}>{t(titleKey)}</h3>
                        <p className={cn('mt-1 text-sm leading-relaxed', TEXT_SECONDARY)}>{t(descKey)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap justify-center gap-3">
                {(
                  [
                    { dot: DOT_SUCCESS, label: t('agentHub.statusLabel'), value: t('agentHub.statusReady') },
                    { dot: DOT_BRAND, label: t('agentHub.collabLabel'), value: t('agentHub.collabValue') },
                    { dot: DOT_BRAND, label: t('agentHub.toolsLabel'), value: t('agentHub.toolsValue') },
                  ] as const
                ).map((row) => (
                  <div
                    key={row.label}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border bg-[#F5F6F7] px-4 py-2.5 text-xs dark:bg-muted/60',
                      BORDER_DEFAULT,
                    )}
                  >
                    <span className={cn('font-medium text-[#4E5969] dark:text-muted-foreground')}>{row.label}</span>
                    <span className="flex items-center gap-1.5 font-semibold text-[#1D2129] dark:text-foreground">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', row.dot)} aria-hidden />
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 bg-[var(--sto-page-bg)] px-4 pb-4 pt-4 sm:px-6 dark:bg-background">
        <div className="mx-auto w-full max-w-[960px]">
          <section className="flex flex-col" aria-label={t('assistant.placeholder')}>
            <ChatInput
              {...useChatInputBindings({
                onSend: handleHubSend,
                onQueue: handleHubQueue,
                variant: 'embedded',
                seedText,
                engineType: currentEngineType,
              })}
              engineType={currentEngineType}
            />
            {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          </section>
          <div className={cn('mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t pt-4 text-xs', BORDER_DEFAULT, TEXT_SECONDARY)}>
            {currentEngineType === 'openclaw' ? (
              <span className="flex items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', isGatewayRunning ? DOT_SUCCESS : 'bg-[#FAAD14]')} aria-hidden />
                {gatewayLine}
              </span>
            ) : currentEngineType === 'claude' ? (
              <span className="flex items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT_SUCCESS)} aria-hidden />
                {t('agentHub.claudeLineConnected')}
              </span>
            ) : <span />}
            <span className="text-center">{t('assistant.footerDisclaimer')}</span>
            <span className="justify-self-end tabular-nums text-right text-[#4E5969] dark:text-muted-foreground">{t('agentHub.usageHint')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
