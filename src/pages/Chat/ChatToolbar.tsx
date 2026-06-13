/**
 * Chat Toolbar
 * Session selector, model selector, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { useMemo, useEffect, useState } from 'react';
import { RefreshCw, Brain, Bot, ChevronDown, Cpu, Check, AlertCircle } from 'lucide-react';
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
  isConcreteModelId,
  resolveChatToolbarModelId,
} from '@/lib/chat-model-options';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

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
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const refresh = useChatStore((s) => s.refresh);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const { t } = useTranslation('chat');

  const { accounts, statuses, vendors, defaultAccountId, init } = useProviderStore();
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [modelSaving, setModelSaving] = useState(false);
  const [engineSaving, setEngineSaving] = useState(false);

  useEffect(() => { void init(); }, [init]);

  const currentAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === currentAgentId),
    [agents, currentAgentId],
  );

  const currentSession = useMemo(
    () => sessions.find((s) => s.key === currentSessionKey),
    [sessions, currentSessionKey],
  );

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

  const agentDefaultEngineType = currentAgent?.engineType ?? 'openclaw';
  const currentEngineType = currentSessionKey === DEFAULT_SESSION_KEY
    ? agentDefaultEngineType
    : currentSession?.engineType ?? agentDefaultEngineType;
  const agentDefaultEngineLabel = agentDefaultEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
  const currentSessionEngineLabel = currentEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
  const showSessionEngineHint = currentSessionKey !== DEFAULT_SESSION_KEY
    && currentSession?.engineType != null
    && currentSession.engineType !== agentDefaultEngineType;

  // session override → agent default → workspace default (Settings 页默认模型)
  useEffect(() => {
    if (modelSaving) return;
    const resolved = currentEngineType === 'claude'
      ? (
        isConcreteModelId(currentAgent?.modelDisplay)
          ? currentAgent?.modelDisplay?.trim()
          : (workspaceDefaultModelId || '')
      )
      : resolveChatToolbarModelId({
        sessionModel: currentSession?.model,
        agentModelDisplay: currentAgent?.modelDisplay,
        agentInheritedModel: currentAgent?.inheritedModel,
        workspaceDefaultModel: workspaceDefaultModelId,
        stoCatalogModelIds,
      });
    if (resolved) {
      setSelectedModelId(resolved);
    } else {
      setSelectedModelId('');
    }
  }, [
    currentEngineType,
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

  const claudeModelConfigured = isConcreteModelId(currentAgent?.modelDisplay);
  const modelDisplayText = selectedModel?.displayName
    ?? (currentEngineType === 'claude' && !claudeModelConfigured
      ? (workspaceDefaultModelId || t('toolbar.modelNotConfigured'))
      : t('toolbar.currentModel'));

  const handleModelSwitch = async (modelId: string) => {
    if (!currentSessionKey || modelId === selectedModelId) return;
    const opt = modelOptions.find((o) => o.modelId === modelId);
    setSelectedModelId(modelId);
    setModelSaving(true);
    try {
      let persistedModel = modelId;
      if (currentEngineType === 'claude' && currentAgentId) {
        const result = await hostApiFetch<{ success?: boolean; snapshot?: { agents?: Array<{ id: string; modelDisplay?: string }> } }>(
          `/api/agents/${encodeURIComponent(currentAgentId)}/model`,
          {
            method: 'PUT',
            body: JSON.stringify({
              model: modelId,
              accountId: opt?.accountId,
            }),
          },
        );
        persistedModel = result.snapshot?.agents?.find((agent) => agent.id === currentAgentId)?.modelDisplay?.trim() || modelId;
        await fetchAgents();
      } else {
        const result = await hostApiFetch<{
          model?: string;
          modelOverride?: string | null;
          changedModel?: boolean;
        }>('/api/sessions/model', {
          method: 'POST',
          body: JSON.stringify({
            sessionKey: currentSessionKey,
            model: modelId,
            accountId: opt?.accountId,
            agentId: currentAgentId || undefined,
            engineType: currentSession?.engineType,
          }),
        });
        persistedModel = (result.modelOverride || result.model || modelId).trim();
      }
      useChatStore.setState((state) => ({
        sessions: state.sessions.map((session) => (
          session.key === currentSessionKey
            ? { ...session, model: persistedModel || modelId }
            : session
        )),
      }));
      void loadSessions();
    } catch (err) {
      toast.error(t('toolbar.modelSwitchFailed', { message: String(err) }));
      const resolved = currentEngineType === 'claude'
        ? (
          isConcreteModelId(currentAgent?.modelDisplay)
            ? currentAgent?.modelDisplay?.trim()
            : (workspaceDefaultModelId || '')
        )
        : resolveChatToolbarModelId({
          sessionModel: currentSession?.model,
          agentModelDisplay: currentAgent?.modelDisplay,
          agentInheritedModel: currentAgent?.inheritedModel,
          workspaceDefaultModel: workspaceDefaultModelId,
          stoCatalogModelIds,
        });
      if (resolved) setSelectedModelId(resolved);
      else setSelectedModelId('');
    } finally {
      setModelSaving(false);
    }
  };

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

  const modelSelectDisabled = (currentEngineType === 'openclaw' && !isGatewayRunning) || sending || modelOptions.length === 0;
  const engineSelectDisabled = sending || !currentAgentId;

  return (
    <div className="flex w-full items-center justify-between gap-3 pt-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:text-[12px]">
          引擎
        </span>
        <DropdownMenu>
          <div className={cn(pillBase, 'max-w-[min(100vw-11rem,220px)]')}>
            <DropdownMenuTrigger asChild disabled={engineSelectDisabled || engineSaving}>
              <button
                type="button"
                title="切换新会话执行引擎"
                className={cn(pillBtn, engineSaving && 'opacity-60 pointer-events-none')}
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
                  {agentDefaultEngineLabel}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
              </button>
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuContent
            align="end"
            side="bottom"
            className="min-w-[12rem] max-w-[min(100vw-2rem,300px)]"
          >
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
        {showSessionEngineHint ? (
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  'inline-flex h-8 max-w-[min(36vw,280px)] items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium',
                  'border-amber-200 bg-amber-50 text-amber-800 shadow-[0_6px_14px_rgba(180,83,9,0.08)]',
                  'dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
                )}
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">当前会话：{currentSessionEngineLabel}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-[280px] text-xs leading-relaxed">
              当前历史会话继续使用 {currentSessionEngineLabel}。上方引擎下拉只影响新会话。
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

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
                  {modelDisplayText}
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
