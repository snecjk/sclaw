import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bot, Check, ChevronDown, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resolveBaseAgentId, resolveEffectiveAgent, useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useCurrentChatRuntimeView } from '@/stores/chat/runtime-selectors';
import { useCurrentChatDisplayMessageCount, useCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
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
import { isMainChatHomePath } from '@/lib/main-chat-navigation';
import { isTaskExecutionSessionKey } from '../../../shared/session-agent-id';
import { resolveChatSessionEngineType, isUnusedEmbedChatSession } from '@/lib/resolve-chat-session-engine-type';
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';
import { cn } from '@/lib/utils';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { toast } from 'sonner';

/** Avoid remapping the same session repeatedly when catalog sanitizes its model. */
const remappedDelistedSessionKeys = new Set<string>();
const pillBase = cn(
  'flex min-w-0 max-w-[min(100vw-11rem,260px)] items-stretch rounded-xl border border-border/70',
  '[background:var(--sto-selector-pill-background)] shadow-[var(--sto-shadow-selector)]',
);

const pillBtn = cn(
  'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg py-0 pl-2.5 pr-2 text-left outline-none',
  'transition-colors hover:bg-[var(--sto-content-hover-background)] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0',
  'disabled:pointer-events-none disabled:opacity-60',
);

const pillStatic = cn(
  'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg py-0 pl-2.5 pr-2',
);

/** 首页 HomeComposer 内联引擎/模型：灰底 pill；模型选中态按内容宽度完整展示。 */
const inlinePillTrigger = cn(
  'flex h-[30px] min-w-0 items-center gap-1 rounded-[20px] bg-[var(--sto-form-disabled-background)] px-3 outline-none',
  'text-sm font-normal text-foreground transition-colors hover:bg-[var(--sto-content-hover-background)]',
  'focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0',
  'disabled:pointer-events-none disabled:opacity-60',
);

const inlineModelPillTrigger = cn(inlinePillTrigger, 'w-max max-w-none shrink-0');

interface SelectorMenuOption<T extends string> {
  key: string;
  value: T;
  label: string;
  decoration?: ReactNode;
}

function SelectorMenu<T extends string>({
  value,
  options,
  disabled,
  title,
  triggerClassName,
  menuWidth,
  children,
  onSelect,
}: {
  value: T;
  options: SelectorMenuOption<T>[];
  disabled?: boolean;
  title: string;
  triggerClassName: string;
  menuWidth: number;
  children: ReactNode;
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(menuWidth, Math.max(0, window.innerWidth - 16));
      const estimatedHeight = Math.min(320, options.length * 36 + 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < estimatedHeight + 12 && rect.top > spaceBelow;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const next: CSSProperties = openAbove
        ? { bottom: window.innerHeight - rect.top + 6, left, width }
        : { top: rect.bottom + 6, left, width };
      setMenuStyle((current) => (
        current.top === next.top
        && current.bottom === next.bottom
        && current.left === next.left
        && current.width === next.width
          ? current
          : next
      ));
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuWidth, open, options.length]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={triggerClassName}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {children}
      </button>
      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={title}
          style={menuStyle}
          className={cn(
            'fixed z-[100001] max-h-[min(320px,calc(100vh-16px))] overflow-y-auto rounded-xl',
            'border border-glass-border bg-popover p-1 text-popover-foreground shadow-lg',
          )}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  'relative flex h-9 w-full select-none items-center gap-2 rounded-md px-2 text-left outline-none',
                  'text-[13px] transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent',
                  selected && 'bg-primary/8 font-medium',
                )}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onSelect(option.value);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.decoration}
                {selected ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

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
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const sessionWorkspaceByKey = useSessionCatalogStore((s) => s.sessionWorkspaceByKey);
  const pendingProjectId = useChatStore((s) => s.pendingProjectId);

  const projectId = useMemo(
    () => getProjectIdFromProjectAgentId(currentAgentId)
      ?? sessionWorkspaceByKey[currentSessionKey]
      ?? pendingProjectId
      ?? null,
    [currentAgentId, currentSessionKey, pendingProjectId, sessionWorkspaceByKey],
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
  const { pathname } = useLocation();
  const { sending } = useCurrentChatRuntimeView();
  const loading = useChatStore((s) => s.loading);
  const messages = useCurrentChatDisplayMessages();
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
  // Only the empty home draft (DEFAULT / unused embed) can switch engines.
  // Existing sessions — including project chats after first send — stay locked.
  const isUnusedEmbedSession = isUnusedEmbedChatSession(currentSessionKey, messages.length, loading);
  const canSwitchEngine = (
    isMainChatHomePath(pathname) && currentSessionKey === DEFAULT_SESSION_KEY
  ) || isUnusedEmbedSession;
  const currentEngineType = resolveChatSessionEngineType(
    currentSession,
    agentDefaultEngineType,
    currentSessionKey,
    { messageCount: messages.length },
  );
  const agentDefaultEngineLabel = agentDefaultEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
  const currentSessionEngineLabel = currentEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
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
      // Project draft may already point at a project agent id — keep its engine mirrored.
      if (currentAgentId && currentAgentId !== baseAgentId) {
        await hostApiFetch(`/api/agents/${encodeURIComponent(currentAgentId)}/engine`, {
          method: 'PUT',
          body: JSON.stringify({ engineType }),
        }).catch(() => {
          // Project agent may not exist until first send; base agent update is enough.
        });
      }
      await fetchAgents();
      toast.success(`新会话将使用 ${engineType === 'claude' ? 'Claude Agent' : 'OpenClaw'} 引擎`);
    } catch (err) {
      toast.error(`切换引擎失败: ${String(err)}`);
    } finally {
      setEngineSaving(false);
    }
  };

  const engineSelectDisabled = sending || !currentAgentId;

  const engineTriggerTitle = canSwitchEngine
    ? '切换新会话执行引擎'
    : isSclawBrowserEmbedChatSessionKey(currentSessionKey) && messages.length > 0
      ? '历史会话不可切换引擎（可切换模型）'
      : '当前会话不可切换引擎';
  const engineOptions: SelectorMenuOption<'openclaw' | 'claude'>[] = [
    { key: 'openclaw', value: 'openclaw', label: 'OpenClaw' },
    { key: 'claude', value: 'claude', label: 'Claude Agent' },
  ];

  if (variant === 'inline') {
    return (
      <SelectorMenu
        value={agentDefaultEngineType}
        options={engineOptions}
        menuWidth={192}
        disabled={engineSelectDisabled || engineSaving || !canSwitchEngine}
        title={engineTriggerTitle}
        triggerClassName={cn(
          inlinePillTrigger,
          'min-w-0 max-w-none flex-1',
          (engineSaving || !canSwitchEngine) && 'opacity-60',
          className,
        )}
        onSelect={(engineType) => void handleEngineSwitch(engineType)}
      >
        <span className="min-w-0 flex-1 truncate">{displayEngineLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
      </SelectorMenu>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span className="shrink-0 whitespace-nowrap px-1 text-[11px] font-medium text-muted-foreground/90 sm:text-[12px]">
        引擎
      </span>
      {canSwitchEngine ? (
        <div className={cn(pillBase, 'max-w-[min(100vw-11rem,200px)]')}>
          <SelectorMenu
            value={agentDefaultEngineType}
            options={engineOptions}
            menuWidth={192}
            disabled={engineSelectDisabled || engineSaving}
            title="切换新会话执行引擎"
            triggerClassName={cn(pillBtn, engineSaving && 'opacity-60')}
            onSelect={(engineType) => void handleEngineSwitch(engineType)}
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
              {agentDefaultEngineLabel}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
          </SelectorMenu>
        </div>
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
                'border-[var(--sto-chat-engine-hint-border)] bg-[var(--sto-chat-engine-hint-background)] text-[var(--sto-chat-engine-hint-foreground)] shadow-[0_6px_14px_rgba(180,83,9,0.08)]',
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
  const { sending } = useCurrentChatRuntimeView();
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
  const [selectionOverride, setSelectionOverride] = useState<{
    sessionKey: string;
    modelId: string;
  } | null>(null);
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

  const messagesLength = useCurrentChatDisplayMessageCount();
  const agentDefaultEngineType = currentAgent?.engineType ?? 'openclaw';
  const currentEngineType = resolveChatSessionEngineType(
    currentSession,
    agentDefaultEngineType,
    currentSessionKey,
    { messageCount: messagesLength },
  );

  const safePending = sanitizeChatModelHint(pendingNewSessionModel, modelOptions);
  const sessionHint = sanitizeChatModelHint(currentSession?.model, modelOptions);
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
  let resolvedSelectedModelId: string;
  if (currentSessionKey === DEFAULT_SESSION_KEY) {
    const hint = currentEngineType === 'claude'
      ? safePending || toolbarHint
      : safePending || workspaceDefaultModelId || '';
    resolvedSelectedModelId = resolveChatSelectedModelId(modelOptions, hint) || hint || '';
  } else if (isTaskExecutionSessionKey(currentSessionKey) && sessionHint) {
    resolvedSelectedModelId = resolveChatSelectedModelId(modelOptions, sessionHint) || sessionHint;
  } else {
    const hint = sessionHint || toolbarHint;
    resolvedSelectedModelId = resolveChatSelectedModelId(modelOptions, hint) || toolbarHint || '';
  }
  const selectedModelId = selectionOverride?.sessionKey === currentSessionKey
    ? selectionOverride.modelId
    : resolvedSelectedModelId;

  useEffect(() => {
    if (modelSaving) return;
    if (pendingNewSessionModel?.trim() && !safePending && modelOptions.length > 0) {
      useChatStore.getState().setPendingNewSessionModel(null);
    }
    if (currentSessionKey === DEFAULT_SESSION_KEY) return;
    if (isTaskExecutionSessionKey(currentSessionKey) && sessionHint) return;

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
    safePending,
    sessionHint,
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
    setSelectionOverride({ sessionKey: currentSessionKey, modelId: rawModelId });

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
        } else {
          useChatStore.setState((state) => ({
            sessions: upsertSessionModel(
              state.sessions,
              currentSessionKey,
              rawModelId,
              { engineType: currentEngineType, label: '新对话' },
            ),
          }));
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
        setSelectionOverride({
          sessionKey: currentSessionKey,
          modelId: resolveChatSelectedModelId(modelOptions, resolved) || resolved || '',
        });
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
      setSelectionOverride({
        sessionKey: currentSessionKey,
        modelId: resolveChatSelectedModelId(modelOptions, resolved) || resolved || '',
      });
    } finally {
      setModelSaving(false);
    }
  };

  const modelSelectDisabled = (currentEngineType === 'openclaw' && !isGatewayRunning) || sending || modelOptions.length === 0;
  const selectorModelOptions: SelectorMenuOption<string>[] = modelOptions.map((option) => ({
    key: option.key,
    value: option.modelId,
    label: option.displayName,
    decoration: (
      <span className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
        option.isBuiltin
          ? 'bg-link-muted text-link'
          : 'bg-[var(--sto-model-custom-tag-background)] text-[var(--sto-model-custom-tag-foreground)]',
      )}>
        {option.isBuiltin ? t('toolbar.modelTagBuiltin') : t('toolbar.modelTagCustom')}
      </span>
    ),
  }));

  if (variant === 'inline') {
    return (
      <SelectorMenu
        value={selectedModelId}
        options={selectorModelOptions}
        menuWidth={360}
        disabled={modelSelectDisabled || modelSaving}
        title={t('toolbar.switchModelTitle')}
        triggerClassName={cn(inlineModelPillTrigger, modelSaving && 'opacity-60', className)}
        onSelect={(modelId) => void handleModelSwitch(modelId)}
      >
        <span className="shrink-0 whitespace-nowrap">{modelDisplayText}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
      </SelectorMenu>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span className="shrink-0 whitespace-nowrap px-1 text-[11px] font-medium text-muted-foreground/90 sm:text-[12px]">
        {t('toolbar.currentModel')}
      </span>
      <div className={cn(pillBase, 'max-w-[min(100vw-11rem,260px)]')}>
        <SelectorMenu
          value={selectedModelId}
          options={selectorModelOptions}
          menuWidth={360}
          disabled={modelSelectDisabled || modelSaving}
          title={t('toolbar.switchModelTitle')}
          triggerClassName={cn(pillBtn, modelSaving && 'opacity-60')}
          onSelect={(modelId) => void handleModelSwitch(modelId)}
        >
          <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
            {modelDisplayText}
          </span>
          {selectedModel ? (
            <span className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
              selectedModel.isBuiltin
                ? 'bg-link-muted text-link'
                : 'bg-[var(--sto-model-custom-tag-background)] text-[var(--sto-model-custom-tag-foreground)]',
            )}>
              {selectedModel.isBuiltin ? t('toolbar.modelTagBuiltin') : t('toolbar.modelTagCustom')}
            </span>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
        </SelectorMenu>
      </div>
    </div>
  );
}

/* ── Combined (backward compat) ──────────────────────────────── */

export function ChatEngineModelSelectors({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-nowrap items-center gap-2 rounded-xl border border-border/60 px-2 py-1',
        'bg-[hsl(var(--glass-bg)/0.55)] backdrop-blur-sm shadow-[var(--sto-shadow-selector-raised)]',
        className,
      )}
    >
      <ChatEngineSelector />
      <ChatModelSelector />
    </div>
  );
}
