/**
 * Chat Toolbar
 * Session selector, model selector, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { useMemo, useEffect, useState } from 'react';
import { RefreshCw, Brain, Bot, ChevronDown, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { buildProviderListItems } from '@/lib/provider-accounts';
import {
  buildChatModelOptions,
  getWorkspaceDefaultModelId,
  resolveChatToolbarModelId,
} from '@/lib/chat-model-options';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';

// ── shared pill style ────────────────────────────────────────────────────────
const pillBase = cn(
  'flex min-w-0 max-w-[min(100vw-11rem,260px)] flex-1 items-stretch rounded-full border border-border',
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.10),transparent),rgba(255,255,255,0.24)]',
  'shadow-[0_8px_18px_rgba(15,23,42,0.06)]',
  'dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent),rgba(255,255,255,0.04)]',
);

const pillBtn = cn(
  'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full py-0 pl-2.5 pr-2 text-left outline-none',
  'transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0',
  'dark:hover:bg-white/[0.06]',
  'disabled:pointer-events-none disabled:opacity-60',
);

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const switchToAgentMainSession = useChatStore((s) => s.switchToAgentMainSession);
  const agents = useAgentsStore((s) => s.agents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const { t } = useTranslation('chat');

  const { accounts, statuses, vendors, defaultAccountId, init } = useProviderStore();
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [modelSaving, setModelSaving] = useState(false);

  useEffect(() => { void init(); }, [init]);

  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );

  const currentAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === currentAgentId),
    [agents, currentAgentId],
  );

  const currentSession = useMemo(
    () => sessions.find((s) => s.key === currentSessionKey),
    [sessions, currentSessionKey],
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
    const mark = currentRow?.isDefault ? ` ${t('toolbar.defaultAgentMark')}` : '';
    return `${base}${mark}`;
  }, [currentRow, currentAgentName, t]);

  const providerItems = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );
  const modelOptions = useMemo(() => buildChatModelOptions(providerItems), [providerItems]);

  const workspaceDefaultModelId = useMemo(
    () => getWorkspaceDefaultModelId(accounts, defaultAccountId),
    [accounts, defaultAccountId],
  );

  const stoCatalogModelIds = useMemo(() => {
    const sto = accounts.find((a) => a.vendorId === 'sto');
    return (sto?.metadata?.customModels as string[] | undefined) ?? [];
  }, [accounts]);

  // session override → agent default → workspace default (Settings 页默认模型)
  useEffect(() => {
    if (modelSaving) return;
    const resolved = resolveChatToolbarModelId({
      sessionModel: currentSession?.model,
      agentModelDisplay: currentAgent?.modelDisplay,
      agentInheritedModel: currentAgent?.inheritedModel,
      workspaceDefaultModel: workspaceDefaultModelId,
      stoCatalogModelIds,
    });
    if (resolved) {
      setSelectedModelId(resolved);
    }
  }, [
    modelSaving,
    currentSessionKey,
    currentSession?.model,
    currentAgentId,
    currentAgent?.modelDisplay,
    currentAgent?.inheritedModel,
    workspaceDefaultModelId,
    stoCatalogModelIds,
  ]);

  const selectedModel = useMemo(
    () => modelOptions.find((o) => o.modelId === selectedModelId),
    [modelOptions, selectedModelId],
  );

  const handleModelSwitch = async (modelId: string) => {
    if (!currentSessionKey || modelId === selectedModelId) return;
    const opt = modelOptions.find((o) => o.modelId === modelId);
    setSelectedModelId(modelId);
    setModelSaving(true);
    try {
      await hostApiFetch('/api/sessions/model', {
        method: 'POST',
        body: JSON.stringify({
          sessionKey: currentSessionKey,
          model: modelId,
          accountId: opt?.accountId,
          agentId: currentAgentId || undefined,
        }),
      });
      void loadSessions();
    } catch (err) {
      toast.error(t('toolbar.modelSwitchFailed', { message: String(err) }));
      const resolved = resolveChatToolbarModelId({
        sessionModel: currentSession?.model,
        agentModelDisplay: currentAgent?.modelDisplay,
        agentInheritedModel: currentAgent?.inheritedModel,
        workspaceDefaultModel: workspaceDefaultModelId,
        stoCatalogModelIds,
      });
      if (resolved) setSelectedModelId(resolved);
    } finally {
      setModelSaving(false);
    }
  };

  const agentSelectDisabled = !isGatewayRunning || sending || agentRows.length === 0;
  const modelSelectDisabled = !isGatewayRunning || sending || modelOptions.length === 0;

  return (
    <div className="flex w-full items-center justify-between">
      {/* LEFT: Agent selector */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:text-[12px]">
          {t('toolbar.conversationTargetLabel')}
        </span>
        <DropdownMenu>
          <div className={cn(pillBase, 'max-w-[min(100vw-11rem,220px)] sm:max-w-[260px]')}>
            <DropdownMenuTrigger asChild disabled={agentSelectDisabled}>
              <button
                type="button"
                title={t('toolbar.switchAgentTitle')}
                aria-label={`${t('toolbar.conversationTargetLabel')}, ${triggerLabel}. ${t('toolbar.switchAgentAria')}`}
                className={pillBtn}
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
                  {triggerLabel}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
              </button>
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuContent
            align="start"
            side="bottom"
            className="min-w-[12rem] max-w-[min(100vw-2rem,320px)]"
          >
            {agentRows.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                className={cn('flex flex-col items-stretch gap-0.5', agent.id === currentAgentId && 'bg-primary/8 font-medium')}
                onSelect={() => switchToAgentMainSession(agent.id)}
              >
                <span className="truncate">
                  {agent.name}{agent.isDefault ? ` ${t('toolbar.defaultAgentMark')}` : ''}
                </span>
                {agent.modelDisplay ? (
                  <span className="truncate text-[11px] font-normal text-muted-foreground">{agent.modelDisplay}</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* RIGHT: Model selector + actions */}
      <div className="flex items-center gap-2">
        {/* Model selector */}
        <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:text-[12px]">
          {t('toolbar.currentModel')}
        </span>
        <DropdownMenu>
          <div className={cn(pillBase, 'max-w-[min(100vw-11rem,260px)]')}>
            <DropdownMenuTrigger asChild disabled={modelSelectDisabled}>
              <button
                type="button"
                title={t('toolbar.switchModelTitle')}
                className={cn(pillBtn, modelSaving && 'opacity-60 pointer-events-none')}
              >
                <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
                  {selectedModel?.displayName ?? t('toolbar.currentModel')}
                </span>
                {selectedModel && (
                  <span className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                    selectedModel.isBuiltin
                      ? 'bg-link-muted text-link dark:bg-[hsl(231_35%_18%)] dark:text-[hsl(var(--link))]'
                      : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
                  )}>
                    {selectedModel.isBuiltin ? t('toolbar.modelTagBuiltin') : t('toolbar.modelTagCustom')}
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
              </button>
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuContent
            align="end"
            side="bottom"
            className="min-w-[14rem] max-w-[min(100vw-2rem,360px)]"
          >
            {modelOptions.length === 0 ? (
              <DropdownMenuItem disabled>
                <span className="text-muted-foreground">{t('toolbar.noModels')}</span>
              </DropdownMenuItem>
            ) : (
              modelOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.key}
                  className={cn('flex items-center gap-2', opt.modelId === selectedModelId && 'bg-primary/8 font-medium')}
                  onSelect={() => void handleModelSwitch(opt.modelId)}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{opt.displayName}</span>
                  <span className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                    opt.isBuiltin
                      ? 'bg-link-muted text-link dark:bg-[hsl(231_35%_18%)] dark:text-[hsl(var(--link))]'
                      : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
                  )}>
                    {opt.isBuiltin ? t('toolbar.modelTagBuiltin') : t('toolbar.modelTagCustom')}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Refresh */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]"
              onClick={() => refresh()}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('toolbar.refresh')}</p></TooltipContent>
        </Tooltip>

        {/* Thinking Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]',
                showThinking && 'bg-primary/12 text-primary',
              )}
              onClick={toggleThinking}
            >
              <Brain className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p></TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
