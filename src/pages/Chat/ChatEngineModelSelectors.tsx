import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, ChevronDown, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resolveBaseAgentId, resolveEffectiveAgent, useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { getProjectIdFromProjectAgentId } from '../../../shared/project-agent';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { buildProviderListItems } from '@/lib/provider-accounts';
import {
  buildChatModelOptions,
  getWorkspaceDefaultModelId,
  getWorkspaceDefaultRawModelId,
  isConcreteModelId,
  normalizeModelIdForChat,
  resolveChatSelectedModelId,
  resolveChatToolbarModelId,
  sanitizeChatModelHint,
  upsertSessionModel,
  type ChatModelOption,
} from '@/lib/chat-model-options';
import { hostApiFetch } from '@/lib/host-api';
import {
  applyClaudeSessionModel,
  applyOpenClawSessionModel,
} from '@/lib/sync-workspace-default-to-chat';
import { isTaskExecutionSessionKey } from '../../../shared/session-agent-id';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';
import { cn } from '@/lib/utils';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { toast } from 'sonner';

/** Avoid remapping the same session repeatedly when catalog sanitizes its model. */
const remappedDelistedSessionKeys = new Set<string>();
/** Above SClaw embed browser drawer/toolbar portals (z-index 99999 / 100000). */
const SELECTOR_MENU_Z = 'z-[100001]';

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

/** 首页 HomeComposer 内联引擎/模型：灰底 pill；模型选中态按内容宽度完整展示。 */
const inlinePillTrigger = cn(
  'flex h-[30px] min-w-0 items-center gap-1 rounded-[20px] bg-[#F5F6F7] px-3 outline-none',
  'text-sm font-normal text-foreground transition-colors hover:bg-black/[0.04]',
  'focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0',
  'disabled:pointer-events-none disabled:opacity-60 dark:bg-muted dark:hover:bg-white/[0.06]',
);

const inlineModelPillTrigger = cn(inlinePillTrigger, 'w-max max-w-none shrink-0');

function isModelNotAllowedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /model not allowed/i.test(message);
}

function isStoBuiltinModelOption(option: ChatModelOption | undefined): boolean {
  return option?.isBuiltin === true && option.accountId === 'sto';
}

/** Sync catalog then remap session to workspace default (delisted STO models). */
async function repairStoCatalogAndRemapToWorkspaceDefault(params: {
  currentSessionKey: string;
  currentAgentId: string;
}): Promise<string> {
  await hostApiFetch('/api/sto-model-sync', { method: 'POST' });
  await useProviderStore.getState().refreshProviderSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const { accounts, defaultAccountId } = useProviderStore.getState();
  const fallbackModelId = getWorkspaceDefaultRawModelId(accounts, defaultAccountId);
  if (!fallbackModelId) {
    throw new Error('No workspace default model available after STO catalog sync');
  }
  const providerItems = buildProviderListItems(
    accounts,
    useProviderStore.getState().statuses,
    useProviderStore.getState().vendors,
    defaultAccountId,
  );
  const options = buildChatModelOptions(providerItems);
  const option = options.find((item) => item.modelId === fallbackModelId)
    ?? options.find((item) => item.normalizedId === normalizeModelIdForChat(fallbackModelId));
  return applyOpenClawSessionModel({
    currentSessionKey: params.currentSessionKey,
    modelId: option?.modelId ?? fallbackModelId,
    accountId: option?.accountId,
    currentAgentId: params.currentAgentId,
  });
}

function resolveClaudeToolbarModelId(input: {
  currentSessionKey: string;
  sessionModel?: string;
  agentModelDisplay?: string;
  workspaceDefaultModelId: string;
  chatModelOptions?: ChatModelOption[];
}): string {
  const options = input.chatModelOptions ?? [];
  const session = sanitizeChatModelHint(input.sessionModel, options);
  const agent = isConcreteModelId(input.agentModelDisplay)
    ? (sanitizeChatModelHint(input.agentModelDisplay, options) || '')
    : '';
  const workspace = input.workspaceDefaultModelId || '';

  if (input.currentSessionKey !== DEFAULT_SESSION_KEY) {
    return session || agent || workspace;
  }
  return agent || workspace;
}

function useProjectAgentContext(currentAgentId: string, currentSessionKey: string) {
  const selectedProjectId = useSessionCatalogStore((s) => s.selectedProjectId);
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const sessionWorkspaceByKey = useSessionCatalogStore((s) => s.sessionWorkspaceByKey);

  const projectId = useMemo(
    () => getProjectIdFromProjectAgentId(currentAgentId)
      ?? sessionWorkspaceByKey[currentSessionKey]
      ?? selectedProjectId,
    [currentAgentId, currentSessionKey, selectedProjectId, sessionWorkspaceByKey],
  );
  const projectName = useMemo(
    () => (projectId ? workspaces.find((workspace) => workspace.id === projectId)?.name ?? null : null),
    [projectId, workspaces],
  );

  return { projectId, projectName };
}

/* ── Engine Selector ─────────────────────────────────────────── */

export function ChatEngineSelector({
  className,
  variant = 'toolbar',
}: {
  className?: string;
  variant?: 'toolbar' | 'inline';
}) {
  const sending = useChatStore((s) => s.sending);
  const loading = useChatStore((s) => s.loading);
  const messages = useChatStore((s) => s.messages);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const { projectId: effectiveProjectId, projectName } = useProjectAgentContext(currentAgentId, currentSessionKey);
  const currentAgent = useMemo(
    () => resolveEffectiveAgent(agents ?? [], currentAgentId, effectiveProjectId, projectName),
    [agents, currentAgentId, effectiveProjectId, projectName],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );

  const agentDefaultEngineType = currentAgent?.engineType ?? 'openclaw';
  // Home empty slot, or embed "new" conversation that has not received any messages yet.
  // History embed sessions keep a fixed engine — switching would risk dropping context.
  const isUnusedEmbedSession = isSclawBrowserEmbedChatSessionKey(currentSessionKey)
    && !loading
    && messages.length === 0;
  const currentEngineType = resolveChatSessionEngineType(
    currentSession,
    agentDefaultEngineType,
    currentSessionKey,
    { messageCount: messages.length },
  );
  const agentDefaultEngineLabel = agentDefaultEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
  const currentSessionEngineLabel = currentEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
  const canSwitchEngine = currentSessionKey === DEFAULT_SESSION_KEY || isUnusedEmbedSession;
  // Unused embed / home slot: engine resolution already follows agent default — keep labels identical.
  const displayEngineLabel = canSwitchEngine
    ? agentDefaultEngineLabel
    : currentSessionEngineLabel;
  const showSessionEngineHint = !canSwitchEngine
    && currentSession?.engineType != null
    && currentSession.engineType !== agentDefaultEngineType;

  const [engineSaving, setEngineSaving] = useState(false);

  const handleEngineSwitch = async (engineType: 'openclaw' | 'claude') => {
    if (!canSwitchEngine || engineType === agentDefaultEngineType) return;
    setEngineSaving(true);
    try {
      const baseAgentId = resolveBaseAgentId(currentAgentId);
      await hostApiFetch(`/api/agents/${encodeURIComponent(baseAgentId)}/engine`, {
        method: 'PUT',
        body: JSON.stringify({ engineType }),
      });
      await fetchAgents();
      toast.success(`新会话将使用 ${engineType === 'claude' ? 'Claude Agent' : 'OpenClaw'} 引擎`);
    } catch (err) {
      toast.error(`切换引擎失败: ${String(err)}`);
    } finally {
      setEngineSaving(false);
    }
  };

  const engineSelectDisabled = sending || !currentAgentId;

  const engineMenu = (
    <DropdownMenuContent
      align="end"
      side="bottom"
      className={cn(SELECTOR_MENU_Z, 'min-w-[12rem] max-w-[min(100vw-2rem,300px)]')}
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
  );

  const engineTriggerTitle = canSwitchEngine
    ? '切换新会话执行引擎'
    : isSclawBrowserEmbedChatSessionKey(currentSessionKey)
      ? '历史会话不可切换引擎（可切换模型）'
      : '当前会话不可切换引擎';

  if (variant === 'inline') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={engineSelectDisabled || engineSaving || !canSwitchEngine}>
          <button
            type="button"
            title={engineTriggerTitle}
            className={cn(
              inlinePillTrigger,
              'min-w-0 max-w-none flex-1',
              (engineSaving || !canSwitchEngine) && 'pointer-events-none opacity-60',
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate">{displayEngineLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
          </button>
        </DropdownMenuTrigger>
        {engineMenu}
      </DropdownMenu>
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
            <DropdownMenuTrigger asChild disabled={engineSelectDisabled || engineSaving}>
              <button
                type="button"
                title="切换新会话执行引擎"
                className={cn(pillBtn, engineSaving && 'pointer-events-none opacity-60')}
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
                  {agentDefaultEngineLabel}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
              </button>
            </DropdownMenuTrigger>
          </div>
          {engineMenu}
        </DropdownMenu>
      ) : (
        <div className={cn(pillBase, pillStatic, 'max-w-[min(100vw-11rem,200px)] opacity-75')}>
          <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted-foreground">
            {displayEngineLabel}
          </span>
        </div>
      )}
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
  );
}

/* ── Model Selector ──────────────────────────────────────────── */

export function ChatModelSelector({
  className,
  variant = 'toolbar',
}: {
  className?: string;
  variant?: 'toolbar' | 'inline';
}) {
  const sending = useChatStore((s) => s.sending);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const { t } = useTranslation('chat');

  const { accounts, statuses, vendors, defaultAccountId, init } = useProviderStore();
  const pendingNewSessionModel = useChatStore((s) => s.pendingNewSessionModel);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [modelSaving, setModelSaving] = useState(false);
  const delistRemapInFlight = useRef(false);

  useEffect(() => { void init(); }, [init]);

  const { projectId: effectiveProjectId, projectName } = useProjectAgentContext(currentAgentId, currentSessionKey);
  const currentAgent = useMemo(
    () => resolveEffectiveAgent(agents ?? [], currentAgentId, effectiveProjectId, projectName),
    [agents, currentAgentId, effectiveProjectId, projectName],
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

  const messagesLength = useChatStore((s) => s.messages.length);
  const agentDefaultEngineType = currentAgent?.engineType ?? 'openclaw';
  const currentEngineType = resolveChatSessionEngineType(
    currentSession,
    agentDefaultEngineType,
    currentSessionKey,
    { messageCount: messagesLength },
  );

  useEffect(() => {
    if (modelSaving) return;
    const safePending = sanitizeChatModelHint(pendingNewSessionModel, modelOptions);
    if (pendingNewSessionModel?.trim() && !safePending && modelOptions.length > 0) {
      useChatStore.getState().setPendingNewSessionModel(null);
    }

    if (currentSessionKey === DEFAULT_SESSION_KEY) {
      if (currentEngineType !== 'claude') {
        const hint = safePending || workspaceDefaultModelId || '';
        setSelectedModelId(resolveChatSelectedModelId(modelOptions, hint) || hint || '');
        return;
      }
      const toolbarHint = resolveClaudeToolbarModelId({
        currentSessionKey,
        sessionModel: currentSession?.model,
        agentModelDisplay: currentAgent?.modelDisplay,
        workspaceDefaultModelId,
        chatModelOptions: modelOptions,
      });
      const hint = safePending || toolbarHint;
      setSelectedModelId(resolveChatSelectedModelId(modelOptions, hint) || hint || '');
      return;
    }

    // Task execution sessions: prefer persisted session.model only (written after trigger).
    const sessionHint = sanitizeChatModelHint(currentSession?.model, modelOptions);
    if (isTaskExecutionSessionKey(currentSessionKey) && sessionHint) {
      setSelectedModelId(resolveChatSelectedModelId(modelOptions, sessionHint) || sessionHint);
      return;
    }

    const toolbarHint = currentEngineType === 'claude'
      ? resolveClaudeToolbarModelId({
        currentSessionKey,
        sessionModel: currentSession?.model,
        agentModelDisplay: currentAgent?.modelDisplay,
        workspaceDefaultModelId,
        chatModelOptions: modelOptions,
      })
      : resolveChatToolbarModelId({
        sessionModel: currentSession?.model,
        agentModelDisplay: currentAgent?.modelDisplay,
        agentInheritedModel: currentAgent?.inheritedModel,
        workspaceDefaultModel: workspaceDefaultModelId,
        stoCatalogModelIds,
        chatModelOptions: modelOptions,
      });
    const hint = sessionHint || toolbarHint;
    setSelectedModelId(resolveChatSelectedModelId(modelOptions, hint) || toolbarHint || '');

    // Persist remap for historical sessions whose override no longer exists in catalog.
    // Skip auto-remap for task sessions — their model comes from the last trigger writeback.
    const rawSessionModel = currentSession?.model?.trim();
    if (
      rawSessionModel
      && modelOptions.length > 0
      && !sessionHint
      && !isTaskExecutionSessionKey(currentSessionKey)
      && !delistRemapInFlight.current
      && !remappedDelistedSessionKeys.has(currentSessionKey)
      && (currentEngineType === 'claude' ? Boolean(currentAgentId) : isGatewayRunning)
    ) {
      const fallbackRaw = getWorkspaceDefaultRawModelId(accounts, defaultAccountId);
      if (!fallbackRaw) return;
      remappedDelistedSessionKeys.add(currentSessionKey);
      delistRemapInFlight.current = true;
      const option = modelOptions.find((item) => item.modelId === fallbackRaw)
        ?? modelOptions.find((item) => item.normalizedId === normalizeModelIdForChat(fallbackRaw));
      const persist = currentEngineType === 'claude'
        ? applyClaudeSessionModel({
          currentSessionKey,
          modelId: option?.modelId ?? fallbackRaw,
          accountId: option?.accountId,
          currentAgentId,
        })
        : applyOpenClawSessionModel({
          currentSessionKey,
          modelId: option?.modelId ?? fallbackRaw,
          accountId: option?.accountId,
          currentAgentId,
        });
      void persist
        .then((persisted) => {
          useChatStore.setState((state) => ({
            sessions: upsertSessionModel(state.sessions, currentSessionKey, persisted),
          }));
          setSelectedModelId(resolveChatSelectedModelId(modelOptions, persisted) || persisted);
        })
        .catch((err) => {
          remappedDelistedSessionKeys.delete(currentSessionKey);
          console.warn('[ChatModelSelector] failed to remap delisted session model:', err);
        })
        .finally(() => {
          delistRemapInFlight.current = false;
        });
    }
  }, [
    currentSessionKey,
    currentEngineType,
    modelSaving,
    pendingNewSessionModel,
    currentSession?.model,
    currentAgent?.modelDisplay,
    currentAgent?.inheritedModel,
    currentAgentId,
    workspaceDefaultModelId,
    stoCatalogModelIds,
    modelOptions,
    accounts,
    defaultAccountId,
    isGatewayRunning,
  ]);

  const selectedModel = useMemo(
    () => modelOptions.find((option) => option.modelId === selectedModelId),
    [modelOptions, selectedModelId],
  );
  const claudeModelConfigured = isConcreteModelId(currentAgent?.modelDisplay);
  // Never paint a bare delisted id that is missing from the live dropdown.
  const modelDisplayText = selectedModel?.displayName
    || workspaceDefaultModelId
    || (currentEngineType === 'claude' && !claudeModelConfigured
      ? t('toolbar.modelNotConfigured')
      : t('toolbar.currentModel'));

  const handleModelSwitch = async (rawModelId: string) => {
    if (!currentSessionKey || rawModelId === selectedModelId) return;
    const option = modelOptions.find((item) => item.modelId === rawModelId);

    if (currentSessionKey === DEFAULT_SESSION_KEY) {
      useChatStore.getState().setPendingNewSessionModel(rawModelId);
      setModelSaving(true);
      try {
        if (currentEngineType === 'claude' && currentAgentId) {
          const result = await hostApiFetch<{
            snapshot?: { agents?: Array<{ id: string; modelDisplay?: string }> };
          }>(`/api/agents/${encodeURIComponent(currentAgentId)}/model`, {
            method: 'PUT',
            body: JSON.stringify({
              model: rawModelId,
              accountId: option?.accountId,
            }),
          });
          await fetchAgents();
          const persistedModel = result.snapshot?.agents?.find((agent) => agent.id === currentAgentId)?.modelDisplay?.trim()
            || rawModelId;
          useChatStore.setState((state) => ({
            sessions: upsertSessionModel(
              state.sessions,
              currentSessionKey,
              persistedModel,
              { engineType: currentEngineType, label: '新对话' },
            ),
          }));
          setSelectedModelId(resolveChatSelectedModelId(modelOptions, persistedModel) || persistedModel);
        } else {
          useChatStore.setState((state) => ({
            sessions: upsertSessionModel(
              state.sessions,
              currentSessionKey,
              rawModelId,
              { engineType: currentEngineType, label: '新对话' },
            ),
          }));
          setSelectedModelId(rawModelId);
        }
      } catch (err) {
        toast.error(t('toolbar.modelSwitchFailed', { message: String(err) }));
        const resolved = currentEngineType === 'claude'
          ? (
            isConcreteModelId(currentAgent?.modelDisplay)
              ? normalizeModelIdForChat(currentAgent?.modelDisplay)
              : (workspaceDefaultModelId || '')
          )
          : resolveChatToolbarModelId({
            sessionModel: currentSession?.model,
            agentModelDisplay: currentAgent?.modelDisplay,
            agentInheritedModel: currentAgent?.inheritedModel,
            workspaceDefaultModel: workspaceDefaultModelId,
            stoCatalogModelIds,
            chatModelOptions: modelOptions,
          });
        setSelectedModelId(resolveChatSelectedModelId(modelOptions, resolved) || resolved || '');
      } finally {
        setModelSaving(false);
      }
      return;
    }

    setModelSaving(true);
    try {
      if (currentEngineType === 'claude' && currentAgentId) {
        const persisted = await applyClaudeSessionModel({
          currentSessionKey,
          modelId: rawModelId,
          accountId: option?.accountId,
          currentAgentId,
        });
        await fetchAgents();
        useChatStore.setState((state) => ({
          sessions: upsertSessionModel(
            state.sessions,
            currentSessionKey,
            persisted,
            { engineType: currentEngineType, label: '新对话' },
          ),
        }));
        setSelectedModelId(resolveChatSelectedModelId(modelOptions, persisted) || persisted);
        return;
      }

      let appliedModelId = rawModelId;
      try {
        appliedModelId = await applyOpenClawSessionModel({
          currentSessionKey,
          modelId: rawModelId,
          accountId: option?.accountId,
          currentAgentId,
        });
      } catch (err) {
        if (isModelNotAllowedError(err) && isStoBuiltinModelOption(option)) {
          appliedModelId = await repairStoCatalogAndRemapToWorkspaceDefault({
            currentSessionKey,
            currentAgentId,
          });
          toast.message(t('toolbar.modelRemappedToDefault', {
            model: normalizeModelIdForChat(appliedModelId) || appliedModelId,
            defaultValue: '模型已下架，已切换为默认模型 {{model}}',
          }));
        } else {
          throw err;
        }
      }
      useChatStore.setState((state) => ({
        sessions: upsertSessionModel(
          state.sessions,
          currentSessionKey,
          appliedModelId,
          { engineType: currentEngineType, label: '新对话' },
        ),
      }));
      setSelectedModelId(resolveChatSelectedModelId(modelOptions, appliedModelId) || appliedModelId);
    } catch (err) {
      toast.error(t('toolbar.modelSwitchFailed', { message: String(err) }));
      const resolved = currentEngineType === 'claude'
        ? resolveClaudeToolbarModelId({
          currentSessionKey,
          sessionModel: currentSession?.model,
          agentModelDisplay: currentAgent?.modelDisplay,
          workspaceDefaultModelId,
          chatModelOptions: modelOptions,
        })
        : resolveChatToolbarModelId({
          sessionModel: currentSession?.model,
          agentModelDisplay: currentAgent?.modelDisplay,
          agentInheritedModel: currentAgent?.inheritedModel,
          workspaceDefaultModel: workspaceDefaultModelId,
          stoCatalogModelIds,
          chatModelOptions: modelOptions,
        });
      setSelectedModelId(resolveChatSelectedModelId(modelOptions, resolved) || resolved || '');
    } finally {
      setModelSaving(false);
    }
  };

  const modelSelectDisabled = (currentEngineType === 'openclaw' && !isGatewayRunning) || sending || modelOptions.length === 0;

  const modelMenu = (
    <DropdownMenuContent
      align="end"
      side="bottom"
      className={cn(SELECTOR_MENU_Z, 'min-w-[14rem] max-w-[min(100vw-2rem,360px)]')}
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

  if (variant === 'inline') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={modelSelectDisabled}>
          <button
            type="button"
            title={t('toolbar.switchModelTitle')}
            className={cn(
              inlineModelPillTrigger,
              modelSaving && 'pointer-events-none opacity-60',
              className,
            )}
          >
            <span className="shrink-0 whitespace-nowrap">{modelDisplayText}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
          </button>
        </DropdownMenuTrigger>
        {modelMenu}
      </DropdownMenu>
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
