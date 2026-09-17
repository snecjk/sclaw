import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bot, Check, ChevronDown, Cpu, Loader2, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resolveBaseAgentId, resolveEffectiveAgent, useAgentsStore } from '@/stores/agents';
import {
  getAgentEnginePolicyOptionLabel,
  useAgentEnginePolicyStore,
} from '@/stores/agent-engine-policy';
import { useAuthStore } from '@/stores/auth';
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
  catalogModelIdsMatch,
  getWorkspaceDefaultModelId,
  getWorkspaceDefaultRawModelId,
  isConcreteModelId,
  normalizeModelIdForChat,
  resolveNewChatSelectedModelId,
  resolveChatSelectedModelId,
  resolveChatToolbarModelId,
  sanitizeChatModelHint,
  upsertSessionModel,
  type ChatModelOption,
} from '@/lib/chat-model-options';
import { hostApiFetch } from '@/lib/host-api';
import {
  applySessionModel,
  applyOpenClawSessionModel,
  syncWorkspaceDefaultModelToChat,
} from '@/lib/sync-workspace-default-to-chat';
import { isMainChatHomePath } from '@/lib/main-chat-navigation';
import { isTaskExecutionSessionKey } from '../../../shared/session-agent-id';
import { resolveChatSessionEngineType, isUnusedEmbedChatSession } from '@/lib/resolve-chat-session-engine-type';
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';
import { cn } from '@/lib/utils';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { toast } from 'sonner';
import type { AgentEngineType } from '../../../shared/agent-engine';
import { InputComposerToolbarIconTooltip } from '@/components/input-composer/input-composer-toolbar-icon-tooltip';

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

function applySessionModelForEngine(params: {
  currentSessionKey: string;
  modelId: string;
  accountId?: string;
  currentAgentId: string;
  engineType: 'openclaw' | 'claude' | 'pi';
}): Promise<string> {
  return applySessionModel({
    ...params,
    engineType: params.engineType,
  });
}

/** Sync catalog then remap session to workspace default (delisted STO models). */
async function repairStoCatalogAndRemapToWorkspaceDefault(params: {
  currentSessionKey: string;
  currentAgentId: string;
  engineType: 'openclaw' | 'claude' | 'pi';
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
  return applySessionModelForEngine({
    currentSessionKey: params.currentSessionKey,
    modelId: option?.modelId ?? fallbackModelId,
    accountId: option?.accountId,
    currentAgentId: params.currentAgentId,
    engineType: params.engineType,
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

function useChatEngineSelection(allowSessionSwitch = false) {
  const { pathname } = useLocation();
  const { sending } = useCurrentChatRuntimeView();
  const loading = useChatStore((s) => s.loading);
  const messages = useCurrentChatDisplayMessages();
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const authUserKey = useAuthStore((s) => s.user?.code || s.user?.empCode || s.user?.id || '');
  const policyEngines = useAgentEnginePolicyStore((s) => s.engines);
  const policyDefaultEngine = useAgentEnginePolicyStore((s) => s.defaultEngine);
  const policyLoading = useAgentEnginePolicyStore((s) => s.loading);
  const policyLoaded = useAgentEnginePolicyStore((s) => s.loaded);
  const policyOwnerCode = useAgentEnginePolicyStore((s) => s.ownerCode);
  const policyConfigVersion = useAgentEnginePolicyStore((s) => s.configVersion);
  const fetchEnginePolicy = useAgentEnginePolicyStore((s) => s.fetchPolicy);

  useEffect(() => {
    if (!authUserKey) return;
    void fetchEnginePolicy(authUserKey);
  }, [authUserKey, fetchEnginePolicy]);

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
  const isUnusedEmbedSession = isUnusedEmbedChatSession(currentSessionKey, messages.length, loading);
  const canSwitchEngine = allowSessionSwitch || (
    isMainChatHomePath(pathname) && currentSessionKey === DEFAULT_SESSION_KEY
  ) || isUnusedEmbedSession;
  const currentEngineType = resolveChatSessionEngineType(
    currentSession,
    agentDefaultEngineType,
    currentSessionKey,
    { messageCount: messages.length },
  );
  const agentDefaultEngineLabel = agentDefaultEngineType === 'claude' ? 'Claude Agent' : agentDefaultEngineType === 'pi' ? 'SAgent' : 'OpenClaw';
  const currentSessionEngineLabel = currentEngineType === 'claude' ? 'Claude Agent' : currentEngineType === 'pi' ? 'SAgent' : 'OpenClaw';
  const displayEngineLabel = canSwitchEngine
    ? agentDefaultEngineLabel
    : currentSessionEngineLabel;
  const showSessionEngineHint = !canSwitchEngine
    && currentSession?.engineType != null
    && currentSession.engineType !== agentDefaultEngineType;

  const [engineSaving, setEngineSaving] = useState(false);

  const handleEngineSwitch = useCallback(async (engineType: AgentEngineType, notify = true) => {
    if (
      !canSwitchEngine
      || engineType === 'openclaw'
      || engineType === agentDefaultEngineType
    ) return;
    setEngineSaving(true);
    try {
      const baseAgentId = resolveBaseAgentId(currentAgentId);
      await hostApiFetch(`/api/agents/${encodeURIComponent(baseAgentId)}/engine`, {
        method: 'PUT',
        body: JSON.stringify({ engineType }),
      });
      if (currentAgentId && currentAgentId !== baseAgentId) {
        await hostApiFetch(`/api/agents/${encodeURIComponent(currentAgentId)}/engine`, {
          method: 'PUT',
          body: JSON.stringify({ engineType }),
        }).catch(() => {
          // Project agent may not exist until first send; base agent update is enough.
        });
      }
      await fetchAgents();
      if (allowSessionSwitch) {
        useChatStore.setState((state) => ({
          sessions: state.sessions.map((session) => (
            session.key === currentSessionKey
              ? { ...session, engineType }
              : session
          )),
        }));
      }
      if (notify) {
        toast.success(`新会话将使用 ${engineType === 'claude' ? 'Claude Agent' : engineType === 'pi' ? 'SAgent' : 'OpenClaw'} 引擎`);
      }
    } catch (err) {
      toast.error(`切换引擎失败: ${String(err)}`);
    } finally {
      setEngineSaving(false);
    }
  }, [agentDefaultEngineType, allowSessionSwitch, canSwitchEngine, currentAgentId, currentSessionKey, fetchAgents]);

  const effectivePolicyLoaded = policyLoaded && policyOwnerCode === (authUserKey.trim() || 'current-user');
  const newSessionPolicyEngines = useMemo(
    () => policyEngines.filter((engine) => engine.code !== 'openclaw'),
    [policyEngines],
  );
  const newSessionDefaultEngine = useMemo(
    () => policyDefaultEngine !== 'openclaw'
      && newSessionPolicyEngines.some((engine) => engine.code === policyDefaultEngine)
      ? policyDefaultEngine
      : newSessionPolicyEngines[0]?.code,
    [newSessionPolicyEngines, policyDefaultEngine],
  );
  const allowedEngineTypes = useMemo(
    () => new Set(newSessionPolicyEngines.map((item) => item.code)),
    [newSessionPolicyEngines],
  );
  const autoEngineReconcileKeyRef = useRef('');

  useEffect(() => {
    if (
      !effectivePolicyLoaded
      || policyLoading
      || engineSaving
      || !canSwitchEngine
      || !currentAgentId
      || !newSessionDefaultEngine
      || allowedEngineTypes.has(agentDefaultEngineType)
    ) return;
    const reconcileKey = [
      policyOwnerCode,
      policyConfigVersion,
      currentAgentId,
      agentDefaultEngineType,
      newSessionDefaultEngine,
    ].join(':');
    if (autoEngineReconcileKeyRef.current === reconcileKey) return;
    autoEngineReconcileKeyRef.current = reconcileKey;
    const timer = window.setTimeout(() => {
      void handleEngineSwitch(newSessionDefaultEngine, false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    agentDefaultEngineType,
    allowedEngineTypes,
    canSwitchEngine,
    currentAgentId,
    effectivePolicyLoaded,
    engineSaving,
    handleEngineSwitch,
    policyConfigVersion,
    policyLoading,
    policyOwnerCode,
    newSessionDefaultEngine,
  ]);

  const engineSelectDisabled = sending
    || !currentAgentId
    || policyLoading
    || !effectivePolicyLoaded
    || newSessionPolicyEngines.length === 0;
  const engineTriggerTitle = allowSessionSwitch
    ? '切换当前建站会话执行引擎'
    : canSwitchEngine
    ? '切换新会话执行引擎'
    : isSclawBrowserEmbedChatSessionKey(currentSessionKey) && messages.length > 0
      ? '历史会话不可切换引擎（可切换模型）'
      : '当前会话不可切换引擎';
  const engineOptions: SelectorMenuOption<AgentEngineType>[] = newSessionPolicyEngines.map((engine) => ({
    key: engine.code,
    value: engine.code,
    label: getAgentEnginePolicyOptionLabel(engine),
  }));

  return {
    agentDefaultEngineType,
    currentEngineType,
    displayEngineLabel,
    canSwitchEngine,
    engineSelectDisabled,
    engineSaving,
    engineTriggerTitle,
    handleEngineSwitch,
    engineOptions,
    showSessionEngineHint,
    currentSessionEngineLabel,
  };
}

export function ChatEngineSelector({
  className,
  variant = 'toolbar',
  allowSessionSwitch = false,
}: {
  className?: string;
  variant?: 'toolbar' | 'inline';
  allowSessionSwitch?: boolean;
}) {
  const {
    agentDefaultEngineType,
    displayEngineLabel,
    canSwitchEngine,
    engineSelectDisabled,
    engineSaving,
    engineTriggerTitle,
    handleEngineSwitch,
    engineOptions,
    showSessionEngineHint,
    currentSessionEngineLabel,
  } = useChatEngineSelection(allowSessionSwitch);

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
              {displayEngineLabel}
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

function useChatModelSelection() {
  const { sending } = useCurrentChatRuntimeView();
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const { t } = useTranslation('chat');

  const {
    accounts,
    statuses,
    vendors,
    defaultAccountId,
    init,
    refreshProviderSnapshot,
    setDefaultAccount,
    updateAccount,
  } = useProviderStore();
  const pendingNewSessionModel = useChatStore((s) => s.pendingNewSessionModel);
  const [selectionOverride, setSelectionOverride] = useState<{
    sessionKey: string;
    modelId: string;
  } | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [defaultModelSavingKey, setDefaultModelSavingKey] = useState<string | null>(null);
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
  const workspaceDefaultRawModelId = useMemo(
    () => getWorkspaceDefaultRawModelId(accounts, defaultAccountId),
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
    resolvedSelectedModelId = resolveNewChatSelectedModelId(
      modelOptions,
      safePending,
      workspaceDefaultModelId,
    );
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
      && (currentEngineType === 'openclaw' ? isGatewayRunning : Boolean(currentAgentId))
    ) {
      const fallbackRaw = getWorkspaceDefaultRawModelId(accounts, defaultAccountId);
      if (!fallbackRaw) return;
      remappedDelistedSessionKeys.add(currentSessionKey);
      delistRemapInFlight.current = true;
      const option = modelOptions.find((item) => item.modelId === fallbackRaw)
        ?? modelOptions.find((item) => item.normalizedId === normalizeModelIdForChat(fallbackRaw));
      const persist = applySessionModelForEngine({
        currentSessionKey,
        modelId: option?.modelId ?? fallbackRaw,
        accountId: option?.accountId,
        currentAgentId,
        engineType: currentEngineType,
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
      if ((currentEngineType === 'claude' || currentEngineType === 'pi') && currentAgentId) {
        const persisted = await applySessionModelForEngine({
          currentSessionKey,
          modelId: rawModelId,
          accountId: option?.accountId,
          currentAgentId,
          engineType: currentEngineType,
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
            engineType: currentEngineType,
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

  /** 按标签内容分配不同颜色，增强视觉区分度 */
  const getInputTagColor = (tag: string): string => {
    switch (tag) {
      case '图片':
        return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400';
      case '视频':
        return 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400';
      case '音频':
        return 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400';
      case '文件':
        return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
      case '代码':
        return 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400';
      default:
        return 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400';
    }
  };

  const selectorModelOptions: SelectorMenuOption<string>[] = modelOptions.map((option) => {
    // 过滤掉"文本"标签（所有模型都支持文本，无需显示）
    const visibleTags = option.inputContent?.filter((t) => t !== '文本') ?? [];
    const inputTags = visibleTags.length
      ? visibleTags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className={cn(
              'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none',
              getInputTagColor(tag),
            )}
          >
            {tag}
          </span>
        ))
      : null;
    const overflowTag = visibleTags.length > 3
      ? (
          <span
            className={cn(
              'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none',
              'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
            )}
          >
            +{visibleTags.length - 3}
          </span>
        )
      : null;
    const customTag = !option.isBuiltin ? (
      <span className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
        'bg-[var(--sto-model-custom-tag-background)] text-[var(--sto-model-custom-tag-foreground)]',
      )}>
        {t('toolbar.modelTagCustom')}
      </span>
    ) : null;
    return {
      key: option.key,
      value: option.modelId,
      label: option.displayName,
      decoration: (inputTags || customTag) ? (
        <span className="flex shrink-0 items-center gap-1">
          {inputTags}
          {overflowTag}
          {customTag}
        </span>
      ) : undefined,
    };
  });
  const defaultModelOptionKey = modelOptions.find((option) => (
    option.accountId === defaultAccountId
    && catalogModelIdsMatch(workspaceDefaultRawModelId, option.modelId)
  ))?.key ?? null;

  const handleSetDefaultModel = async (optionKey: string) => {
    const option = modelOptions.find((item) => item.key === optionKey);
    if (!option || option.key === defaultModelOptionKey || defaultModelSavingKey) return;

    const account = accounts.find((item) => item.id === option.accountId);
    if (!account) return;

    setDefaultModelSavingKey(option.key);
    try {
      if (defaultAccountId !== option.accountId) {
        await setDefaultAccount(option.accountId);
      }
      if (account.model !== option.modelId) {
        await updateAccount(option.accountId, { model: option.modelId });
      } else {
        await refreshProviderSnapshot();
      }
      await syncWorkspaceDefaultModelToChat({
        modelId: option.modelId,
        accountId: option.accountId,
        previousWorkspaceModel: workspaceDefaultModelId,
      });
      toast.success(t('toolbar.defaultModelUpdated'));
    } catch (err) {
      toast.error(t('toolbar.defaultModelUpdateFailed', { message: String(err) }));
    } finally {
      setDefaultModelSavingKey(null);
    }
  };

  return {
    selectedModelId,
    modelDisplayText,
    selectedModel,
    selectorModelOptions,
    modelSelectDisabled,
    modelSaving,
    defaultModelOptionKey,
    defaultModelSavingKey,
    handleModelSwitch,
    handleSetDefaultModel,
    switchTitle: t('toolbar.switchModelTitle'),
    customTag: t('toolbar.modelTagCustom'),
  };
}

export function ChatModelSelector({
  className,
  variant = 'toolbar',
}: {
  className?: string;
  variant?: 'toolbar' | 'inline';
}) {
  const { t } = useTranslation('chat');
  const {
    selectedModelId,
    modelDisplayText,
    selectedModel,
    selectorModelOptions,
    modelSelectDisabled,
    modelSaving,
    handleModelSwitch,
    switchTitle,
    customTag,
  } = useChatModelSelection();

  if (variant === 'inline') {
    return (
      <SelectorMenu
        value={selectedModelId}
        options={selectorModelOptions}
        menuWidth={360}
        disabled={modelSelectDisabled || modelSaving}
        title={switchTitle}
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
          title={switchTitle}
          triggerClassName={cn(pillBtn, modelSaving && 'opacity-60')}
          onSelect={(modelId) => void handleModelSwitch(modelId)}
        >
          <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
            {modelDisplayText}
          </span>
          {selectedModel && !selectedModel.isBuiltin ? (
            <span className={cn(
              'shrink-0 rounded bg-[var(--sto-model-custom-tag-background)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--sto-model-custom-tag-foreground)]',
            )}>
              {customTag}
            </span>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
        </SelectorMenu>
      </div>
    </div>
  );
}

/* ── Combined independent engine/model picker ────────────────── */

export function ChatEngineModelPicker({
  className,
  allowSessionSwitch = false,
}: {
  className?: string;
  allowSessionSwitch?: boolean;
}) {
  const { t } = useTranslation('chat');
  const {
    agentDefaultEngineType,
    currentEngineType,
    displayEngineLabel,
    canSwitchEngine,
    engineSelectDisabled,
    engineSaving,
    engineTriggerTitle,
    handleEngineSwitch,
    engineOptions,
  } = useChatEngineSelection(allowSessionSwitch);
  const {
    selectedModelId,
    modelDisplayText,
    selectorModelOptions,
    modelSelectDisabled,
    modelSaving,
    defaultModelOptionKey,
    defaultModelSavingKey,
    handleModelSwitch,
    handleSetDefaultModel,
    switchTitle,
  } = useChatModelSelection();

  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedEngine = canSwitchEngine ? agentDefaultEngineType : currentEngineType;
  const busy = engineSaving || modelSaving || defaultModelSavingKey !== null;
  const triggerDisabled = engineSelectDisabled && modelSelectDisabled;

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(440, Math.max(0, window.innerWidth - 16));
      const estimatedHeight = 280;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < estimatedHeight + 12 && rect.top > spaceBelow;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
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
  }, [open]);

  const pickEngine = (engineType: 'openclaw' | 'claude' | 'pi') => {
    if (!canSwitchEngine || engineSelectDisabled || busy) return;
    void handleEngineSwitch(engineType);
  };

  const pickModel = (modelId: string) => {
    if (modelSelectDisabled || busy) return;
    setOpen(false);
    void handleModelSwitch(modelId);
  };

  return (
    <>
      <InputComposerToolbarIconTooltip label={`${engineTriggerTitle} · ${switchTitle}`}>
      <span className="inline-flex min-w-0 max-w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={triggerDisabled || busy}
        className={cn(
          inlinePillTrigger,
          'min-w-0 max-w-full gap-1.5',
          busy && 'opacity-60',
          className,
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">
          <span className={cn(
            canSwitchEngine && !engineSelectDisabled ? 'text-foreground' : 'text-muted-foreground',
          )}>
            {displayEngineLabel}
          </span>
          <span className="mx-1 text-muted-foreground/50">·</span>
          <span>{modelDisplayText}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
      </button>
      </span>
      </InputComposerToolbarIconTooltip>
      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label="选择引擎和模型"
          style={menuStyle}
          className={cn(
            'fixed z-[100001] flex max-h-[min(360px,calc(100vh-16px))] overflow-hidden rounded-xl',
            'border border-glass-border bg-popover text-popover-foreground shadow-lg',
          )}
        >
          <div className="flex w-[168px] shrink-0 flex-col border-r border-border/70 p-1">
            <p className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">引擎</p>
            {engineOptions.map((option) => {
              const selected = option.value === selectedEngine;
              const lockedOut = !canSwitchEngine && option.value !== currentEngineType;
              return (
                <button
                  key={option.key}
                  type="button"
                  disabled={engineSelectDisabled || busy || lockedOut}
                  className={cn(
                    'relative flex h-9 w-full select-none items-center gap-1 rounded-md px-2 text-left text-[13px] outline-none',
                    'transition-colors hover:bg-accent hover:text-accent-foreground',
                    selected && 'bg-primary/8 font-medium',
                    lockedOut && 'opacity-40',
                  )}
                  onClick={() => pickEngine(option.value)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {selected ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-1">
            <p className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
              模型
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectorModelOptions.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无可用模型</p>
              ) : selectorModelOptions.map((option) => {
                const selected = option.value === selectedModelId;
                const isDefault = option.key === defaultModelOptionKey;
                const savingDefault = option.key === defaultModelSavingKey;
                return (
                  <div
                    key={option.key}
                    className={cn(
                      'relative flex h-9 w-full select-none items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none',
                      'transition-colors hover:bg-accent hover:text-accent-foreground',
                      selected && 'bg-primary/8 font-medium',
                    )}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={modelSelectDisabled || busy}
                      className="min-w-0 flex-1 truncate text-left outline-none disabled:pointer-events-none disabled:opacity-60"
                      onClick={() => pickModel(option.value)}
                    >
                      {option.label}
                    </button>
                    {option.decoration}
                    <button
                      type="button"
                      disabled={isDefault || busy}
                      aria-label={t(isDefault ? 'toolbar.defaultModel' : 'toolbar.setDefaultModel')}
                      title={t(isDefault ? 'toolbar.defaultModel' : 'toolbar.setDefaultModel')}
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors',
                        isDefault
                          ? 'text-amber-500'
                          : 'text-muted-foreground/45 hover:bg-amber-500/10 hover:text-amber-500',
                        'focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:pointer-events-none',
                      )}
                      onClick={() => void handleSetDefaultModel(option.key)}
                    >
                      {savingDefault ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Star className="h-3.5 w-3.5" fill={isDefault ? 'currentColor' : 'none'} aria-hidden />
                      )}
                    </button>
                    {selected ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
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
