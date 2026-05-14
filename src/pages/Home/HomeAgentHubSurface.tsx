/**
 * 无 CRM 周报策略权限时的首页：智能助手工作台概览（色板对齐 docs/sto-design.md）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot, BrainCircuit, Cpu, RefreshCw, Repeat2, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useProviderStore } from '@/stores/providers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildProviderListItems } from '@/lib/provider-accounts';
import { buildChatModelOptions } from '@/lib/chat-model-options';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';

/** sto-design Grey-10 主标题 / 默认正文 */
const TEXT_PRIMARY = 'text-[#1D2129] dark:text-foreground';
/** sto-design Grey-8 次要 */
const TEXT_SECONDARY = 'text-[#86909C] dark:text-muted-foreground';
/** sto-design Grey-4 边框 */
const BORDER_DEFAULT = 'border-[#E5E6EB] dark:border-border';
/** sto-design Blue-1 浅底、Blue-6 图标主色（Link/Info） */
const INFO_ICON_WRAP =
  'bg-link-muted text-link dark:bg-[hsl(231_35%_18%)] dark:text-[hsl(var(--link))]';
/** sto-design Grey-3 底 + Grey-9 字：能力场景 pill 纯展示（无选中、无交互、无 hover） */
const MODE_CHIP_DECORATIVE =
  'rounded-full border border-transparent bg-[#F0F2F5] px-4 py-2 text-sm font-medium text-[#4E5969] dark:bg-muted dark:text-muted-foreground';
/** sto-design Brand-1 + Brand-7 功能角标 */
const TAG_FUNCTION =
  'rounded-md bg-[#FFF5E6] px-2 py-0.5 text-xs font-medium text-[#D95700] dark:bg-amber-950/45 dark:text-amber-200';
/** sto-design Green-6 就绪点 */
const DOT_SUCCESS = 'bg-[#00B54B]';
/** sto-design Blue-6 信息点 */
const DOT_INFO = 'bg-[#4760FE]';

/** 首页顶栏下拉触发器（sto-design 白底 + Grey-4 边，hover 弱 Brand 边） */
const hubSelectTrigger = cn(
  'flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2.5 text-left text-sm outline-none transition-colors',
  'hover:border-[#FFC17A] focus-visible:ring-2 focus-visible:ring-[#4760FE]/35 focus-visible:ring-offset-0 dark:bg-card',
  BORDER_DEFAULT,
  TEXT_PRIMARY,
  'disabled:pointer-events-none disabled:opacity-50',
);

export function HomeAgentHubSurface() {
  const { t } = useTranslation(['home', 'chat']);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelSaving, setModelSaving] = useState(false);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const abortRun = useChatStore((s) => s.abortRun);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const switchToAgentMainSession = useChatStore((s) => s.switchToAgentMainSession);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);

  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const { accounts, statuses, vendors, defaultAccountId, init } = useProviderStore();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );

  const currentAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === currentAgentId),
    [agents, currentAgentId],
  );

  const agentRows = useMemo(() => {
    const list = [...(agents ?? [])];
    if (currentAgentId && !list.some((a) => a.id === currentAgentId)) {
      list.unshift({
        id: currentAgentId,
        name: currentAgentName,
        isDefault: false,
        modelDisplay: '',
        inheritedModel: false,
        workspace: '',
        agentDir: '',
        mainSessionKey: '',
        channelTypes: [],
      });
    }
    return list;
  }, [agents, currentAgentId, currentAgentName]);

  const currentRow = useMemo(
    () => agentRows.find((a) => a.id === currentAgentId),
    [agentRows, currentAgentId],
  );

  const triggerLabel = useMemo(() => {
    const base = currentRow?.name ?? currentAgentName;
    const mark = currentRow?.isDefault ? ` ${t('chat:toolbar.defaultAgentMark')}` : '';
    return `${base}${mark}`;
  }, [currentRow, currentAgentName, t]);

  const providerItems = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );
  const modelOptions = useMemo(() => buildChatModelOptions(providerItems), [providerItems]);

  useEffect(() => {
    if (!modelSaving && currentAgent?.modelDisplay) {
      setSelectedModelId(currentAgent.modelDisplay);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAgentId, currentAgent?.modelDisplay]);

  const selectedModel = useMemo(
    () => modelOptions.find((o) => o.modelId === selectedModelId),
    [modelOptions, selectedModelId],
  );

  const handleModelSwitch = async (modelId: string) => {
    if (!currentAgentId || modelId === selectedModelId) return;
    setSelectedModelId(modelId);
    setModelSaving(true);
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(currentAgentId)}/model`, {
        method: 'PUT',
        body: JSON.stringify({ model: modelId }),
      });
      void fetchAgents();
    } catch (err) {
      toast.error(t('chat:toolbar.modelSwitchFailed', { message: String(err) }));
      if (currentAgent?.modelDisplay) setSelectedModelId(currentAgent.modelDisplay);
    } finally {
      setModelSaving(false);
    }
  };

  const agentSelectDisabled = !isGatewayRunning || sending || agentRows.length === 0;
  const modelSelectDisabled = !isGatewayRunning || sending || modelOptions.length === 0;

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4 sm:px-6', BORDER_DEFAULT)}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('text-xs font-medium', TEXT_SECONDARY)}>{t('agentHub.conversationLabel')}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={agentSelectDisabled}>
              <button
                type="button"
                className={cn(hubSelectTrigger, 'max-w-md')}
                title={t('chat:toolbar.switchAgentTitle')}
                aria-label={`${t('agentHub.conversationLabel')}, ${triggerLabel}. ${t('chat:toolbar.switchAgentAria')}`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Bot className="h-4 w-4 shrink-0 text-[#4760FE] dark:text-[hsl(var(--link))]" strokeWidth={1.75} aria-hidden />
                  <span className="truncate font-medium">{triggerLabel}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[#C9CDD4] dark:text-muted-foreground" strokeWidth={2.25} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="bottom"
              className="min-w-[12rem] max-w-[min(100vw-2rem,320px)]"
            >
              {agentRows.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  className={cn(
                    'flex flex-col items-stretch gap-0.5',
                    agent.id === currentAgentId && 'bg-primary/8 font-medium',
                  )}
                  onSelect={() => switchToAgentMainSession(agent.id)}
                >
                  <span className="truncate">
                    {agent.name}
                    {agent.isDefault ? ` ${t('chat:toolbar.defaultAgentMark')}` : ''}
                  </span>
                  {agent.modelDisplay ? (
                    <span className="truncate text-[11px] font-normal text-muted-foreground">{agent.modelDisplay}</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex shrink-0 items-end gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className={cn('text-xs font-medium', TEXT_SECONDARY)}>{t('agentHub.modelLabel')}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={modelSelectDisabled}>
                <button
                  type="button"
                  className={cn(hubSelectTrigger, 'min-w-[200px] max-w-[min(100vw-8rem,280px)]', modelSaving && 'pointer-events-none opacity-60')}
                  title={t('chat:toolbar.switchModelTitle')}
                  aria-label={t('chat:toolbar.switchModelTitle')}
                >
                  <Cpu className="h-4 w-4 shrink-0 text-[#4760FE] dark:text-[hsl(var(--link))]" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {selectedModel?.displayName ?? t('chat:toolbar.currentModel')}
                  </span>
                  {selectedModel ? (
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                        selectedModel.isBuiltin
                          ? 'bg-link-muted text-link dark:bg-[hsl(231_35%_18%)] dark:text-[hsl(var(--link))]'
                          : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
                      )}
                    >
                      {selectedModel.isBuiltin ? t('chat:toolbar.modelTagBuiltin') : t('chat:toolbar.modelTagCustom')}
                    </span>
                  ) : null}
                  <ChevronDown className="h-4 w-4 shrink-0 text-[#C9CDD4] dark:text-muted-foreground" strokeWidth={2.25} aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="bottom"
                className="min-w-[14rem] max-w-[min(100vw-2rem,360px)]"
              >
                {modelOptions.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <span className="text-muted-foreground">{t('chat:toolbar.noModels')}</span>
                  </DropdownMenuItem>
                ) : (
                  modelOptions.map((opt) => (
                    <DropdownMenuItem
                      key={opt.key}
                      className={cn(
                        'flex items-center gap-2',
                        opt.modelId === selectedModelId && 'bg-primary/8 font-medium',
                      )}
                      onSelect={() => void handleModelSwitch(opt.modelId)}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px]">{opt.displayName}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                          opt.isBuiltin
                            ? 'bg-link-muted text-link dark:bg-[hsl(231_35%_18%)] dark:text-[hsl(var(--link))]'
                            : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
                        )}
                      >
                        {opt.isBuiltin ? t('chat:toolbar.modelTagBuiltin') : t('chat:toolbar.modelTagCustom')}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white text-[#4E5969] transition-colors',
                  'hover:border-[#FFC17A] hover:text-[#D95700] disabled:opacity-50 dark:bg-card dark:text-muted-foreground dark:hover:border-amber-800/60 dark:hover:text-amber-200',
                  BORDER_DEFAULT,
                )}
                aria-label={t('chat:toolbar.refresh')}
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw className={cn('h-[18px] w-[18px]', loading && 'animate-spin')} strokeWidth={1.75} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('chat:toolbar.refresh')}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white text-[#4760FE] transition-colors',
                  'hover:bg-link-muted dark:bg-card dark:text-[hsl(var(--link))] dark:hover:bg-[hsl(231_35%_20%)]',
                  showThinking && 'border-[#FFC17A] bg-[#FFF5E6] dark:border-amber-800/50 dark:bg-amber-950/40',
                  BORDER_DEFAULT,
                )}
                aria-label={showThinking ? t('chat:toolbar.hideThinking') : t('chat:toolbar.showThinking')}
                aria-pressed={showThinking}
                onClick={() => toggleThinking()}
              >
                <BrainCircuit className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{showThinking ? t('chat:toolbar.hideThinking') : t('chat:toolbar.showThinking')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-6">
        <div
          className="flex flex-wrap justify-center gap-2"
          role="group"
          aria-label={t('agentHub.modeChipsGroupLabel')}
        >
          <span className={MODE_CHIP_DECORATIVE}>{t('agentHub.modeAssistant')}</span>
          <span className={MODE_CHIP_DECORATIVE}>{t('agentHub.modeWorkbench')}</span>
          <span className={MODE_CHIP_DECORATIVE}>{t('agentHub.modeMulti')}</span>
        </div>

        <div className="mt-8 text-center">
          <h1 className={cn('text-2xl font-bold tracking-tight sm:text-[28px] sm:leading-snug', TEXT_PRIMARY)}>
            {t('agentHub.headline')}
          </h1>
          <p className={cn('mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed', TEXT_SECONDARY)}>
            {t('agentHub.subline')}
          </p>
        </div>

        <div className="mx-auto mt-10 grid w-full max-w-[960px] gap-4 sm:grid-cols-3">
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

        <div className="mx-auto mt-8 flex flex-wrap justify-center gap-3">
          {(
            [
              { dot: DOT_SUCCESS, label: t('agentHub.statusLabel'), value: t('agentHub.statusReady') },
              { dot: DOT_INFO, label: t('agentHub.collabLabel'), value: t('agentHub.collabValue') },
              { dot: DOT_INFO, label: t('agentHub.toolsLabel'), value: t('agentHub.toolsValue') },
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

        <div className="mx-auto mt-auto w-full max-w-[960px] flex-1 pt-10">
          <section className="flex flex-col" aria-label={t('agentHub.inputPlaceholder')}>
            <ChatInput
              variant="embedded"
              onSend={handleHubSend}
              onStop={() => void abortRun()}
              onQueue={handleHubQueue}
              disabled={!isGatewayRunning}
              sending={sending}
            />
            {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          </section>
          <p className={cn('mt-3 text-center text-xs leading-relaxed', TEXT_SECONDARY)}>{t('assistant.footerDisclaimer')}</p>
        </div>

        <div className={cn('mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs', BORDER_DEFAULT, TEXT_SECONDARY)}>
          <span className="flex items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', isGatewayRunning ? DOT_SUCCESS : 'bg-[#FAAD14]')} aria-hidden />
            {gatewayLine}
          </span>
          <span className="tabular-nums text-[#4E5969] dark:text-muted-foreground">{t('agentHub.usageHint')}</span>
        </div>
      </div>
    </div>
  );
}
