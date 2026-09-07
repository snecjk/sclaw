/**
 * After workspace default model changes in Settings, sync agents list and
 * the active chat session when it was using the previous workspace default.
 *
 * Session model persistence (`/api/sessions/model`) is the execution source of truth
 * for OpenClaw Gateway modelOverride / Claude session registry.
 */
import { hostApiFetch } from '@/lib/host-api';
import {
  catalogModelIdsMatch,
  getWorkspaceDefaultRawModelId,
  isConcreteModelId,
  normalizeModelIdForChat,
  resolveProviderRawModelId,
  shouldSyncSessionToWorkspaceDefault,
  upsertSessionModel,
} from '@/lib/chat-model-options';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import type { ChatEngineType } from '@/lib/resolve-chat-session-engine-type';
import { resolveAgentById, useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import { buildChatSessionRuntimeView } from '@/stores/chat/runtime-selectors';
import { useProviderStore } from '@/stores/providers';
import type { ProviderAccount } from '@/lib/providers';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

/** STO account: reject models that disappeared from customModels (delisted). */
export function isModelStillAllowedForAccount(
  accounts: ProviderAccount[],
  modelId: string,
  accountId: string,
): boolean {
  const account = accounts.find((item) => item.id === accountId);
  if (!account || account.vendorId !== 'sto') return true;
  const catalog = (account.metadata?.customModels as string[] | undefined) ?? [];
  if (catalog.length === 0) return true;
  return catalog.some(
    (catalogId) => (
      catalogModelIdsMatch(modelId, catalogId)
      || normalizeModelIdForChat(catalogId) === normalizeModelIdForChat(modelId)
    ),
  );
}

function patchSessionModelInStore(sessionKey: string, persisted: string): void {
  useChatStore.setState((state) => ({
    sessions: upsertSessionModel(state.sessions, sessionKey, persisted),
  }));
}

export async function syncWorkspaceDefaultModelToChat(opts: {
  modelId: string;
  accountId: string;
  previousWorkspaceModel?: string;
}): Promise<void> {
  const modelId = opts.modelId.trim();
  const accountId = opts.accountId.trim();
  if (!modelId || !accountId) return;

  void useAgentsStore.getState().fetchAgents();

  const chat = useChatStore.getState();
  const { currentSessionKey, currentAgentId, sessions, loadSessions } = chat;
  if (!currentSessionKey) return;

  // Placeholder new-chat page: user choice lives in pendingNewSessionModel, not main session.
  if (currentSessionKey === DEFAULT_SESSION_KEY) return;

  const session = sessions.find((s) => s.key === currentSessionKey);
  if (!shouldSyncSessionToWorkspaceDefault(session?.model, opts.previousWorkspaceModel)) {
    return;
  }

  const agent = resolveAgentById(useAgentsStore.getState().agents, currentAgentId);
  const engineType = resolveChatSessionEngineType(session, agent?.engineType, currentSessionKey);

  const target = normalizeModelIdForChat(modelId);
  const current = normalizeModelIdForChat(session?.model);
  if (current === target) return;

  try {
    if (buildChatSessionRuntimeView(
      useChatRuntimeV2Store.getState().sessionsByKey[currentSessionKey],
    ).sending) {
      // Model switch aborts the active run; don't let that abort auto-fire queued messages.
      const { suspendAutoSend } = await import('@/stores/message-queue');
      suspendAutoSend(currentSessionKey);
      await chat.abortRun();
    }
    const persisted = await persistSessionModelToGateway({
      sessionKey: currentSessionKey,
      model: modelId,
      accountId,
      agentId: currentAgentId || '',
      engineType,
    });
    patchSessionModelInStore(currentSessionKey, persisted);
    void loadSessions();
  } catch (err) {
    console.warn('[syncWorkspaceDefaultModelToChat] failed:', err);
  }
}

/**
 * Persist session-scoped model via Host API. Returns Gateway/Claude written id.
 * Throws when resolve or HTTP write fails (callers must not swallow for send barrier).
 */
export async function persistSessionModelToGateway(opts: {
  sessionKey: string;
  model: string;
  accountId: string;
  agentId: string;
  engineType: ChatEngineType;
}): Promise<string> {
  const { accounts } = useProviderStore.getState();
  const resolved = resolveProviderRawModelId(accounts, opts.model, opts.accountId);
  if (!resolved) {
    throw new Error(`Unable to resolve model "${opts.model}" for session model persist`);
  }

  const result = await hostApiFetch<{
    model?: string;
    modelOverride?: string | null;
    success?: boolean;
    error?: string;
  }>('/api/sessions/model', {
    method: 'POST',
    body: JSON.stringify({
      sessionKey: opts.sessionKey,
      model: resolved.modelId,
      accountId: resolved.accountId,
      agentId: opts.agentId.trim() || undefined,
      engineType: opts.engineType,
    }),
  });

  if (result && typeof result === 'object' && result.success === false) {
    throw new Error(result.error || 'Failed to set session model');
  }

  const persisted = (result.modelOverride || result.model || resolved.modelId).trim();
  if (!persisted) {
    throw new Error('Session model persist returned empty model');
  }
  return persisted;
}

/** Shared entry point for session-scoped model switches across all engines. */
export async function applySessionModel(params: {
  currentSessionKey: string;
  modelId: string;
  accountId?: string;
  currentAgentId: string;
  engineType: ChatEngineType;
}): Promise<string> {
  return persistSessionModelToGateway({
    sessionKey: params.currentSessionKey,
    model: params.modelId,
    accountId: params.accountId?.trim() || '',
    agentId: params.currentAgentId,
    engineType: params.engineType,
  });
}

/** Compatibility helpers for existing engine-specific callers. */
export async function applyClaudeSessionModel(params: {
  currentSessionKey: string;
  modelId: string;
  accountId?: string;
  currentAgentId: string;
}): Promise<string> {
  return applySessionModel({
    ...params,
    engineType: 'claude',
  });
}

export async function applyOpenClawSessionModel(params: {
  currentSessionKey: string;
  modelId: string;
  accountId?: string;
  currentAgentId: string;
}): Promise<string> {
  return applySessionModel({
    ...params,
    engineType: 'openclaw',
  });
}

export async function applyPiSessionModel(params: {
  currentSessionKey: string;
  modelId: string;
  accountId?: string;
  currentAgentId: string;
}): Promise<string> {
  return applySessionModel({
    ...params,
    engineType: 'pi',
  });
}

/**
 * Decide which model to persist for a session (decision rule, not a display source).
 * Priority: session.model → pending → workspace default, for every engine.
 * Callers that are switching to a different engine can opt out of the stored
 * session or pending model, which may have been inherited from that other engine.
 */
export function resolveModelToPersistForSession(opts: {
  sessionKey: string;
  agentId: string;
  engineType: ChatEngineType;
  /** Ignore an existing session model when it belongs to a different engine flow. */
  preferSessionModel?: boolean;
  /** Ignore the unsent new-chat selection when it belongs to a different engine flow. */
  preferPendingModel?: boolean;
}): { modelId: string; accountId: string } | null {
  const sessionKey = opts.sessionKey.trim();
  if (!sessionKey) return null;

  const { accounts, defaultAccountId } = useProviderStore.getState();
  const fallbackAccountId = defaultAccountId?.trim()
    || accounts.find((account) => account.vendorId === 'sto')?.id
    || accounts[0]?.id
    || '';
  if (!fallbackAccountId) return null;

  const chat = useChatStore.getState();
  const session = chat.sessions.find((item) => item.key === sessionKey);
  const agent = useAgentsStore.getState().agents.find((item) => item.id === opts.agentId);

  const tryResolve = (
    raw: string | undefined | null,
    preferredAccountId: string,
  ): { modelId: string; accountId: string } | null => {
    const trimmed = raw?.trim();
    if (!trimmed || !isConcreteModelId(trimmed)) return null;
    const resolved = resolveProviderRawModelId(accounts, trimmed, preferredAccountId);
    if (!resolved) return null;
    if (!isModelStillAllowedForAccount(accounts, resolved.modelId, resolved.accountId)) {
      return null;
    }
    return resolved;
  };

  const sessionPreferredAccount = opts.engineType === 'claude'
    ? (agent?.modelAccountId?.trim() || fallbackAccountId)
    : fallbackAccountId;

  if (opts.preferSessionModel !== false) {
    const fromSession = tryResolve(session?.model, sessionPreferredAccount);
    if (fromSession) return fromSession;
  }

  if (opts.preferPendingModel !== false) {
    const fromPending = tryResolve(chat.pendingNewSessionModel, sessionPreferredAccount);
    if (fromPending) return fromPending;
  }

  const workspaceRaw = getWorkspaceDefaultRawModelId(accounts, defaultAccountId);
  return tryResolve(workspaceRaw, fallbackAccountId);
}

/**
 * Before chat.send: force-persist the selected/resolved model to Gateway/Claude storage.
 * Returns the persisted model id. Throws on failure (caller must block send).
 */
export async function ensureSelectedModelPersistedBeforeSend(opts: {
  sessionKey: string;
  agentId: string;
  engineType: ChatEngineType;
}): Promise<string> {
  const sessionKey = opts.sessionKey.trim();
  if (!sessionKey) {
    throw new Error('Cannot persist session model: missing sessionKey');
  }
  if (sessionKey === DEFAULT_SESSION_KEY) {
    throw new Error('Cannot persist model on placeholder session; create a real session first');
  }

  const target = resolveModelToPersistForSession(opts);
  if (!target) {
    throw new Error('Cannot determine model to persist before send');
  }

  const persisted = await persistSessionModelToGateway({
    sessionKey,
    model: target.modelId,
    accountId: target.accountId,
    agentId: opts.agentId,
    engineType: opts.engineType,
  });
  patchSessionModelInStore(sessionKey, persisted);
  useChatStore.getState().setPendingNewSessionModel(null);
  return persisted;
}

/**
 * @deprecated Prefer ensureSelectedModelPersistedBeforeSend (throws on failure).
 * Thin wrapper kept for any leftover call sites during migration.
 */
export async function ensureSessionModelAvailableBeforeSend(opts: {
  sessionKey: string;
  agentId: string;
  engineType: ChatEngineType;
}): Promise<void> {
  await ensureSelectedModelPersistedBeforeSend(opts);
}

/**
 * After STO catalog sync (login / periodic / manual): refresh provider + agent
 * snapshots and align pending/current session UI to the latest workspace default.
 */
export async function applyStoCatalogSyncToChatUi(payload?: {
  fallbackModel?: string;
}): Promise<void> {
  try {
    await useProviderStore.getState().refreshProviderSnapshot();
  } catch (err) {
    console.warn('[applyStoCatalogSyncToChatUi] provider refresh failed:', err);
  }
  try {
    await useAgentsStore.getState().fetchAgents();
  } catch (err) {
    console.warn('[applyStoCatalogSyncToChatUi] agents refresh failed:', err);
  }

  const { accounts, defaultAccountId } = useProviderStore.getState();
  const fallbackModel = (
    payload?.fallbackModel?.trim()
    || getWorkspaceDefaultRawModelId(accounts, defaultAccountId)
  ).trim();
  const fallbackAccountId = defaultAccountId?.trim()
    || accounts.find((account) => account.vendorId === 'sto')?.id
    || '';

  const chat = useChatStore.getState();
  const pending = chat.pendingNewSessionModel?.trim();
  if (pending && fallbackAccountId) {
    const resolved = resolveProviderRawModelId(accounts, pending, fallbackAccountId);
    if (
      !resolved
      || !isModelStillAllowedForAccount(accounts, resolved.modelId, resolved.accountId)
    ) {
      chat.setPendingNewSessionModel(null);
    }
  }

  const sessionKey = chat.currentSessionKey?.trim();
  if (!sessionKey || sessionKey === DEFAULT_SESSION_KEY || !fallbackModel || !fallbackAccountId) {
    return;
  }

  const session = chat.sessions.find((item) => item.key === sessionKey);
  const sessionModel = session?.model?.trim();
  if (!sessionModel) {
    // Task sessions often omit model — still clear local display by upserting fallback
    // when agent preferred was remapped server-side (agents store already refreshed).
    return;
  }

  const resolved = resolveProviderRawModelId(accounts, sessionModel, fallbackAccountId);
  if (
    resolved
    && isModelStillAllowedForAccount(accounts, resolved.modelId, resolved.accountId)
  ) {
    return;
  }

  const agent = useAgentsStore.getState().agents.find((item) => item.id === chat.currentAgentId);
  const engineType = resolveChatSessionEngineType(session, agent?.engineType, sessionKey);
  try {
    const persisted = await persistSessionModelToGateway({
      sessionKey,
      model: fallbackModel,
      accountId: fallbackAccountId,
      agentId: chat.currentAgentId || agent?.id || '',
      engineType,
    });
    patchSessionModelInStore(sessionKey, persisted);
  } catch (err) {
    console.warn('[applyStoCatalogSyncToChatUi] session remap failed:', err);
  }
}

/** Apply workspace default model to a newly created session (toolbar + gateway).
 *  If the session already carries a model (e.g. from pendingNewSessionModel),
 *  that user-chosen model wins over the global workspace default.
 *  Persist failures throw so send/newSession callers can block. */
export async function applyWorkspaceDefaultToNewSession(
  sessionKey: string,
  agentId: string,
): Promise<void> {
  const trimmedKey = sessionKey.trim();
  if (!trimmedKey) return;

  const existingSession = useChatStore.getState().sessions.find((s) => s.key === trimmedKey);
  const agent = useAgentsStore.getState().agents.find((item) => item.id === agentId);
  const engineType = resolveChatSessionEngineType(existingSession, agent?.engineType, trimmedKey);
  const { accounts, defaultAccountId } = useProviderStore.getState();
  const fallbackAccountId = defaultAccountId?.trim() ?? '';
  if (!fallbackAccountId) {
    throw new Error('No default provider account available to persist session model');
  }

  const userChosenModel = existingSession?.model?.trim();
  if (userChosenModel) {
    const preferredAccountId = engineType === 'claude'
      ? (agent?.modelAccountId?.trim() || fallbackAccountId)
      : fallbackAccountId;
    const resolved = resolveProviderRawModelId(accounts, userChosenModel, preferredAccountId);
    if (
      resolved
      && isModelStillAllowedForAccount(accounts, resolved.modelId, resolved.accountId)
    ) {
      const persisted = await persistSessionModelToGateway({
        sessionKey: trimmedKey,
        model: resolved.modelId,
        accountId: resolved.accountId,
        agentId,
        engineType,
      });
      patchSessionModelInStore(trimmedKey, persisted);
      useChatStore.getState().setPendingNewSessionModel(null);
      return;
    }
    // Delisted user pick → fall through to workspace default.
    useChatStore.getState().setPendingNewSessionModel(null);
  }

  const rawModelId = getWorkspaceDefaultRawModelId(accounts, defaultAccountId);
  if (!rawModelId) {
    throw new Error('No workspace default model available to persist for new session');
  }

  const persisted = await persistSessionModelToGateway({
    sessionKey: trimmedKey,
    model: rawModelId,
    accountId: fallbackAccountId,
    agentId,
    engineType,
  });
  patchSessionModelInStore(trimmedKey, persisted);
  void useChatStore.getState().loadSessions();
  void useAgentsStore.getState().fetchAgents();
}

/** Sync an explicit model selection for a session to the Gateway session store. */
export async function syncSessionModelToGateway(
  sessionKey: string,
  modelId: string,
  agentId: string,
): Promise<void> {
  const trimmedKey = sessionKey.trim();
  const trimmedModel = modelId.trim();
  if (!trimmedKey || !trimmedModel) return;

  const existingSession = useChatStore.getState().sessions.find((s) => s.key === trimmedKey);
  const agent = useAgentsStore.getState().agents.find((item) => item.id === agentId);
  // Claude models are managed by the engine registry, not the Gateway session store.
  if (agent?.engineType === 'claude' && isConcreteModelId(agent.modelDisplay)) return;

  const engineType = resolveChatSessionEngineType(existingSession, agent?.engineType, trimmedKey);

  const { defaultAccountId } = useProviderStore.getState();
  const accountId = defaultAccountId?.trim() ?? '';
  if (!accountId) return;

  try {
    await hostApiFetch('/api/sessions/model', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: trimmedKey,
        model: trimmedModel,
        accountId,
        agentId: agentId.trim() || undefined,
        engineType,
      }),
    });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.key === trimmedKey
          ? { ...session, model: trimmedModel }
          : session
      )),
    }));
    void useChatStore.getState().loadSessions();
    void useAgentsStore.getState().fetchAgents();
  } catch (err) {
    console.warn('[syncSessionModelToGateway] failed:', err);
  }
}
