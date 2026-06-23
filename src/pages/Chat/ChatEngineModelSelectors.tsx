import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Cpu } from 'lucide-react';
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
import { useProviderStore } from '@/stores/providers';
import { buildProviderListItems } from '@/lib/provider-accounts';
import {
  buildChatModelOptions,
  getWorkspaceDefaultModelId,
  isConcreteModelId,
  normalizeModelIdForChat,
  resolveChatToolbarModelId,
  upsertSessionModel,
  type ChatModelOption,
} from '@/lib/chat-model-options';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { toast } from 'sonner';

const pillBase = cn(
  'flex min-w-0 max-w-[min(100vw-11rem,260px)] items-stretch rounded-xl border border-border/70',
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.10),transparent),rgba(255,255,255,0.30)]',
  'shadow-[0_4px_12px_rgba(15,23,42,0.05)]',
  'dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent),rgba(255,255,255,0.04)]',
);

const pillBtn = cn(
  'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg py-0 pl-2.5 pr-2 text-left outline-none',
  'transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0',
  'dark:hover:bg-white/[0.06]',
  'disabled:pointer-events-none disabled:opacity-60',
);

const pillStatic = cn(
  'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg py-0 pl-2.5 pr-2',
);

const composerIconBtn = cn(
  'inline-flex h-8 w-8 items-center justify-center bg-transparent p-0',
  'text-muted-foreground/75 outline-none transition-colors hover:text-foreground',
  'focus-visible:ring-0 focus:bg-transparent data-[state=open]:bg-transparent',
);

const composerModelPill = cn(
  'flex h-8 max-w-[min(42vw,180px)] items-center gap-1 rounded-full border border-border/70 px-2.5',
  'bg-white/50 text-[12px] font-medium text-foreground/90 outline-none transition-colors',
  'hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-primary/25 dark:bg-white/[0.06] dark:hover:bg-white/[0.09]',
  'disabled:pointer-events-none disabled:opacity-60',
);

export type ChatSelectorVariant = 'toolbar' | 'composer';

function isModelNotAllowedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /model not allowed/i.test(message);
}

function isStoBuiltinModelOption(option: ChatModelOption | undefined): boolean {
  return option?.isBuiltin === true && option.accountId === 'sto';
}

async function applyClaudeSessionModel(params: {
  currentSessionKey: string;
  modelId: string;
  option?: ChatModelOption;
  currentAgentId: string;
}): Promise<string> {
  const result = await hostApiFetch<{
    model?: string;
    modelOverride?: string | null;
  }>('/api/sessions/model', {
    method: 'POST',
    body: JSON.stringify({
      sessionKey: params.currentSessionKey,
      model: params.modelId,
      accountId: params.option?.accountId,
      agentId: params.currentAgentId || undefined,
      engineType: 'claude',
    }),
  });
  return (result.modelOverride || result.model || params.modelId).trim();
}

async function applyOpenClawSessionModel(params: {
  currentSessionKey: string;
  modelId: string;
  option?: ChatModelOption;
  currentAgentId: string;
}): Promise<string> {
  const result = await hostApiFetch<{
    model?: string;
    modelOverride?: string | null;
  }>('/api/sessions/model', {
    method: 'POST',
    body: JSON.stringify({
      sessionKey: params.currentSessionKey,
      model: params.modelId,
      accountId: params.option?.accountId,
      agentId: params.currentAgentId || undefined,
      engineType: 'openclaw',
    }),
  });
  return (result.modelOverride || result.model || params.modelId).trim();
}

async function repairStoCatalogAndRetrySessionModel(params: {
  currentSessionKey: string;
  modelId: string;
  option?: ChatModelOption;
  currentAgentId: string;
}): Promise<string> {
  await hostApiFetch('/api/sto-model-sync', { method: 'POST' });
  await useProviderStore.getState().refreshProviderSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return applyOpenClawSessionModel(params);
}

export function ChatEngineSelector({
  className,
  variant = 'toolbar',
}: {
  className?: string;
  variant?: ChatSelectorVariant;
}) {
  const sending = useChatStore((s) => s.sending);
  const messages = useChatStore((s) => s.messages);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  // const loadSessions = useChatStore((s) => s.loadSessions);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );

  const agentDefaultEngineType = currentAgent?.engineType ?? 'openclaw';
  const hasFormalChat = messages.length > 0 || sending;
  // Editable only before the first real message; locked once chatting starts.
  const canSwitchEngine = !hasFormalChat;
  const currentEngineType = hasFormalChat
    ? (currentSession?.engineType ?? agentDefaultEngineType)
    : agentDefaultEngineType;
  const engineLabel = currentEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
  const engineMenuOptions = canSwitchEngine
    ? (['openclaw', 'claude'] as const)
    : ([currentEngineType] as const);

  const [engineSaving, setEngineSaving] = useState(false);

  const handleEngineSwitch = async (engineType: 'openclaw' | 'claude') => {
    if (!canSwitchEngine || engineType === agentDefaultEngineType) return;
    setEngineSaving(true);
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(currentAgentId)}/engine`, {
        method: 'PUT',
        body: JSON.stringify({ engineType }),
      });
      await fetchAgents();
      if (currentSessionKey !== DEFAULT_SESSION_KEY) {
        useChatStore.setState((state) => ({
          sessions: state.sessions.map((session) => (
            session.key === currentSessionKey
              ? { ...session, engineType }
              : session
          )),
        }));
      }
      // await loadSessions(); // 这行代码会出现个BUG：新对话中切换引擎，会跳转到下方最近一次的对话框中
      toast.success(`新会话将使用 ${engineType === 'claude' ? 'Claude Agent' : 'OpenClaw'} 引擎`);
    } catch (err) {
      toast.error(`切换引擎失败: ${String(err)}`);
    } finally {
      setEngineSaving(false);
    }
  };

  const engineMenu = (
    <DropdownMenuContent
      align={variant === 'composer' ? 'start' : 'end'}
      side={variant === 'composer' ? 'top' : 'bottom'}
      className="min-w-[12rem] max-w-[min(100vw-2rem,300px)]"
    >
      {engineMenuOptions.map((engineType) => {
        const label = engineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
        const isSelected = canSwitchEngine
          ? agentDefaultEngineType === engineType
          : currentEngineType === engineType;
        return (
          <DropdownMenuItem
            key={engineType}
            disabled={!canSwitchEngine}
            className={cn(
              'flex items-center gap-2',
              isSelected && 'bg-primary/8 font-medium',
              !canSwitchEngine && 'cursor-default opacity-100',
            )}
            onSelect={(event) => {
              if (!canSwitchEngine) {
                event.preventDefault();
                return;
              }
              void handleEngineSwitch(engineType);
            }}
          >
            <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
            {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );

  if (variant === 'composer') {
    return (
      <div className={cn('inline-flex shrink-0', className)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={sending || engineSaving}>
            <button
              type="button"
              title={canSwitchEngine ? '切换新会话执行引擎' : `当前引擎：${engineLabel}`}
              aria-label={canSwitchEngine ? `切换引擎，当前 ${engineLabel}` : `查看当前引擎：${engineLabel}`}
              className={cn(
                composerIconBtn,
                (sending || engineSaving) && 'pointer-events-none opacity-60',
                currentEngineType === 'claude' && 'text-primary',
                !canSwitchEngine && 'opacity-80',
              )}
            >
              <Bot className="h-3.5 w-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          {engineMenu}
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span className="shrink-0 whitespace-nowrap px-1 text-[11px] font-medium text-muted-foreground/90 sm:text-[12px]">
        引擎
      </span>
      {canSwitchEngine ? (
        <DropdownMenu>
          <div className={cn(pillBase, 'max-w-[min(100vw-11rem,200px)]')}>
            <DropdownMenuTrigger asChild disabled={sending || engineSaving}>
              <button
                type="button"
                title="切换新会话执行引擎"
                className={cn(pillBtn, engineSaving && 'opacity-60 pointer-events-none')}
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
                  {engineLabel}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
              </button>
            </DropdownMenuTrigger>
          </div>
          {engineMenu}
        </DropdownMenu>
      ) : (
        <DropdownMenu>
          <div className={cn(pillBase, 'max-w-[min(100vw-11rem,200px)]')}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={`当前引擎：${engineLabel}`}
                className={cn(pillBtn, 'opacity-75')}
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted-foreground">
                  {engineLabel}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
              </button>
            </DropdownMenuTrigger>
          </div>
          {engineMenu}
        </DropdownMenu>
      )}
    </div>
  );
}

/* ── Model Selector ──────────────────────────────────────────── */

export function ChatModelSelector({
  className,
  variant = 'toolbar',
}: {
  className?: string;
  variant?: ChatSelectorVariant;
}) {
  const sending = useChatStore((s) => s.sending);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  // const loadSessions = useChatStore((s) => s.loadSessions);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const { t } = useTranslation('chat');

  const { accounts, statuses, vendors, defaultAccountId, init, refreshProviderSnapshot } = useProviderStore();
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [modelSaving, setModelSaving] = useState(false);

  useEffect(() => { void init(); }, [init]);

  const prevGatewayState = useRef(gatewayStatus.state);
  useEffect(() => {
    if (prevGatewayState.current !== 'running' && gatewayStatus.state === 'running') {
      void refreshProviderSnapshot();
    }
    prevGatewayState.current = gatewayStatus.state;
  }, [gatewayStatus.state, refreshProviderSnapshot]);

  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
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
    const sto = accounts.find((account) => account.vendorId === 'sto');
    return (sto?.metadata?.customModels as string[] | undefined) ?? [];
  }, [accounts]);

  const agentDefaultEngineType = currentAgent?.engineType ?? 'openclaw';
  const currentEngineType = currentSessionKey === DEFAULT_SESSION_KEY
    ? agentDefaultEngineType
    : currentSession?.engineType ?? agentDefaultEngineType;

  useEffect(() => {
    if (modelSaving) return;
    const resolved = currentEngineType === 'claude'
      ? (
        currentSessionKey !== DEFAULT_SESSION_KEY
          ? (
            normalizeModelIdForChat(currentSession?.model)
            || (isConcreteModelId(currentAgent?.modelDisplay)
              ? normalizeModelIdForChat(currentAgent?.modelDisplay)
              : (workspaceDefaultModelId || ''))
          )
          : (
            isConcreteModelId(currentAgent?.modelDisplay)
              ? normalizeModelIdForChat(currentAgent?.modelDisplay)
              : (workspaceDefaultModelId || '')
          )
      )
      : resolveChatToolbarModelId({
        sessionModel: currentSession?.model,
        agentModelDisplay: currentAgent?.modelDisplay,
        agentInheritedModel: currentAgent?.inheritedModel,
        workspaceDefaultModel: workspaceDefaultModelId,
        stoCatalogModelIds,
      });
    setSelectedModelId(resolved || '');
  }, [
    currentEngineType,
    modelSaving,
    currentSessionKey,
    currentSession?.model,
    currentAgent?.modelDisplay,
    currentAgent?.inheritedModel,
    workspaceDefaultModelId,
    stoCatalogModelIds,
  ]);

  const selectedModel = useMemo(
    () => modelOptions.find((option) => option.modelId === selectedModelId),
    [modelOptions, selectedModelId],
  );
  const claudeModelConfigured = isConcreteModelId(currentAgent?.modelDisplay);
  const modelDisplayText = selectedModel?.displayName
    ?? (currentEngineType === 'claude' && !claudeModelConfigured
      ? (workspaceDefaultModelId || t('toolbar.modelNotConfigured'))
      : t('toolbar.currentModel'));

  const handleModelSwitch = async (modelId: string) => {
    if (!currentSessionKey || modelId === selectedModelId) return;
    const option = modelOptions.find((item) => item.modelId === modelId);
    setSelectedModelId(modelId);
    setModelSaving(true);
    try {
      let persistedModel = modelId;
      if (currentEngineType === 'claude' && currentAgentId) {
        if (currentSessionKey !== DEFAULT_SESSION_KEY) {
          persistedModel = await applyClaudeSessionModel({
            currentSessionKey,
            modelId,
            option,
            currentAgentId,
          });
        } else {
          const result = await hostApiFetch<{ snapshot?: { agents?: Array<{ id: string; modelDisplay?: string }> } }>(
            `/api/agents/${encodeURIComponent(currentAgentId)}/model`,
            {
              method: 'PUT',
              body: JSON.stringify({
                model: modelId,
                accountId: option?.accountId,
              }),
            },
          );
          persistedModel = result.snapshot?.agents?.find((agent) => agent.id === currentAgentId)?.modelDisplay?.trim() || modelId;
          await fetchAgents();
        }
      } else {
        const sessionParams = {
          currentSessionKey,
          modelId,
          option,
          currentAgentId,
        };
        try {
          persistedModel = await applyOpenClawSessionModel(sessionParams);
        } catch (err) {
          if (isModelNotAllowedError(err) && isStoBuiltinModelOption(option)) {
            persistedModel = await repairStoCatalogAndRetrySessionModel(sessionParams);
          } else {
            throw err;
          }
        }
      }
      useChatStore.setState((state) => ({
        sessions: upsertSessionModel(
          state.sessions,
          currentSessionKey,
          persistedModel || modelId,
          { engineType: currentEngineType, label: '新对话' },
        ),
      }));
      // void loadSessions(); // 这行代码会出现个BUG：新对话中切换模型，会跳转到下方最近一次的对话框中
    } catch (err) {
      toast.error(t('toolbar.modelSwitchFailed', { message: String(err) }));
      const resolved = currentEngineType === 'claude'
        ? (
          currentSessionKey !== DEFAULT_SESSION_KEY
            ? (
              normalizeModelIdForChat(currentSession?.model)
              || (isConcreteModelId(currentAgent?.modelDisplay)
                ? normalizeModelIdForChat(currentAgent?.modelDisplay)
                : (workspaceDefaultModelId || ''))
            )
            : (
              isConcreteModelId(currentAgent?.modelDisplay)
                ? normalizeModelIdForChat(currentAgent?.modelDisplay)
                : (workspaceDefaultModelId || '')
            )
        )
        : resolveChatToolbarModelId({
          sessionModel: currentSession?.model,
          agentModelDisplay: currentAgent?.modelDisplay,
          agentInheritedModel: currentAgent?.inheritedModel,
          workspaceDefaultModel: workspaceDefaultModelId,
          stoCatalogModelIds,
        });
      setSelectedModelId(resolved || '');
    } finally {
      setModelSaving(false);
    }
  };

  const modelSelectDisabled = (currentEngineType === 'openclaw' && !isGatewayRunning) || sending || modelOptions.length === 0;

  const modelMenu = (
    <DropdownMenuContent
      align="end"
      side={variant === 'composer' ? 'top' : 'bottom'}
      className="min-w-[14rem] max-w-[min(100vw-2rem,360px)]"
    >
      {modelOptions.length === 0 ? (
        <DropdownMenuItem disabled>
          <span className="text-muted-foreground">{t('toolbar.noModels')}</span>
        </DropdownMenuItem>
      ) : (
        modelOptions.map((option) => (
          <DropdownMenuItem
            key={option.key}
            className={cn('flex items-center gap-2', option.modelId === selectedModelId && 'bg-primary/8 font-medium')}
            onSelect={() => void handleModelSwitch(option.modelId)}
          >
            <span className="min-w-0 flex-1 truncate text-[13px]">{option.displayName}</span>
            <span className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
              option.isBuiltin
                ? 'bg-link-muted text-link dark:bg-[hsl(231_35%_18%)] dark:text-[hsl(var(--link))]'
                : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
            )}>
              {option.isBuiltin ? t('toolbar.modelTagBuiltin') : t('toolbar.modelTagCustom')}
            </span>
          </DropdownMenuItem>
        ))
      )}
    </DropdownMenuContent>
  );

  if (variant === 'composer') {
    return (
      <div className={cn('inline-flex min-w-0 shrink', className)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={modelSelectDisabled}>
            <button
              type="button"
              title={t('toolbar.switchModelTitle')}
              className={cn(composerModelPill, modelSaving && 'pointer-events-none opacity-60')}
            >
              <span className="min-w-0 truncate">{modelDisplayText}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
            </button>
          </DropdownMenuTrigger>
          {modelMenu}
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span className="shrink-0 whitespace-nowrap px-1 text-[11px] font-medium text-muted-foreground/90 sm:text-[12px]">
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
              {selectedModel ? (
                <span className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                  selectedModel.isBuiltin
                    ? 'bg-link-muted text-link dark:bg-[hsl(231_35%_18%)] dark:text-[hsl(var(--link))]'
                    : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
                )}>
                  {selectedModel.isBuiltin ? t('toolbar.modelTagBuiltin') : t('toolbar.modelTagCustom')}
                </span>
              ) : null}
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
            </button>
          </DropdownMenuTrigger>
        </div>
        {modelMenu}
      </DropdownMenu>
    </div>
  );
}

/* ── Combined (backward compat) ──────────────────────────────── */

export function ChatEngineModelSelectors({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-nowrap items-center gap-2 rounded-xl border border-border/60 px-2 py-1',
        'bg-[hsl(var(--glass-bg)/0.55)] backdrop-blur-sm shadow-[0_6px_14px_rgba(15,23,42,0.05)]',
        className,
      )}
    >
      <ChatEngineSelector />
      <ChatModelSelector />
    </div>
  );
}
