/**
 * After workspace default model changes in Settings, sync agents list and
 * the active chat session when it was using the previous workspace default.
 */
import { hostApiFetch } from '@/lib/host-api';
import {
  catalogModelIdsMatch,
  getWorkspaceDefaultRawModelId,
  isConcreteModelId,
  normalizeModelIdForChat,
  resolveProviderRawModelId,
  shouldSyncSessionToWorkspaceDefault,
} from '@/lib/chat-model-options';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import type { ChatEngineType } from '@/lib/resolve-chat-session-engine-type';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';
import type { ProviderAccount } from '@/lib/providers';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

/** STO account: reject models that disappeared from customModels (delisted). */
function isModelStillAllowedForAccount(
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

  const agent = useAgentsStore.getState().agents.find((item) => item.id === currentAgentId);
  const engineType = resolveChatSessionEngineType(session, agent?.engineType, currentSessionKey);

  const target = normalizeModelIdForChat(modelId);
  const current = normalizeModelIdForChat(session?.model);
  if (current === target) return;

  try {
    if (chat.sending) {
      // Model switch aborts the active run; don't let that abort auto-fire queued messages.
      const { suspendAutoSend } = await import('@/stores/message-queue');
      suspendAutoSend(currentSessionKey);
      await chat.abortRun();
    }
    await hostApiFetch('/api/sessions/model', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: currentSessionKey,
        model: modelId,
        accountId,
        agentId: currentAgentId || undefined,
        engineType,
      }),
    });
    void loadSessions();
  } catch (err) {
    console.warn('[syncWorkspaceDefaultModelToChat] failed:', err);
  }
}

async function persistSessionModelToGateway(opts: {
  sessionKey: string;
  model: string;
  accountId: string;
  agentId: string;
  engineType: ChatEngineType;
}): Promise<string | null> {
  const { accounts } = useProviderStore.getState();
  const resolved = resolveProviderRawModelId(accounts, opts.model, opts.accountId);
  if (!resolved) return null;

  const result = await hostApiFetch<{
    model?: string;
    modelOverride?: string | null;
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

  return (result.modelOverride || result.model || resolved.modelId).trim() || null;
}

/**
 * Before chat.send: if the session still carries a delisted STO model, await remap
 * to the workspace default so Gateway modelOverride matches the toolbar.
 * UI-only sanitize is not enough — send uses Gateway session storage.
 */
export async function ensureSessionModelAvailableBeforeSend(opts: {
  sessionKey: string;
  agentId: string;
  engineType: ChatEngineType;
}): Promise<void> {
  const sessionKey = opts.sessionKey.trim();
  if (!sessionKey || sessionKey === DEFAULT_SESSION_KEY) return;

  const session = useChatStore.getState().sessions.find((item) => item.key === sessionKey);
  const sessionModel = session?.model?.trim();
  if (!sessionModel) return;

  const { accounts, defaultAccountId } = useProviderStore.getState();
  const preferredAccountId = defaultAccountId?.trim() || '';
  const resolved = resolveProviderRawModelId(accounts, sessionModel, preferredAccountId || undefined);
  if (
    resolved
    && isModelStillAllowedForAccount(accounts, resolved.modelId, resolved.accountId)
  ) {
    return;
  }

  const fallbackModel = getWorkspaceDefaultRawModelId(accounts, defaultAccountId);
  const fallbackAccountId = preferredAccountId
    || resolved?.accountId
    || accounts.find((account) => account.vendorId === 'sto')?.id
    || '';
  if (!fallbackModel || !fallbackAccountId) return;

  try {
    const persisted = await persistSessionModelToGateway({
      sessionKey,
      model: fallbackModel,
      accountId: fallbackAccountId,
      agentId: opts.agentId,
      engineType: opts.engineType,
    });
    if (persisted) {
      useChatStore.setState((state) => ({
        sessions: state.sessions.map((item) => (
          item.key === sessionKey ? { ...item, model: persisted } : item
        )),
      }));
    }
  } catch (err) {
    console.warn('[ensureSessionModelAvailableBeforeSend] failed:', err);
  }
}

/** Apply workspace default model to a newly created session (toolbar + gateway).
 *  If the session already carries a model (e.g. from pendingNewSessionModel),
 *  that user-chosen model wins over the global workspace default. */
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
  if (!fallbackAccountId) return;

  const userChosenModel = existingSession?.model?.trim();
  if (userChosenModel) {
    try {
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
        if (persisted) {
          useChatStore.setState((state) => ({
            sessions: state.sessions.map((session) => (
              session.key === trimmedKey
                ? { ...session, model: persisted }
                : session
            )),
          }));
        }
        useChatStore.getState().setPendingNewSessionModel(null);
        return;
      }
      // Delisted user pick → fall through to workspace / Claude agent default.
    } catch (err) {
      console.warn('[applyWorkspaceDefaultToNewSession] failed to persist user-chosen model:', err);
      useChatStore.getState().setPendingNewSessionModel(null);
      return;
    }
    useChatStore.getState().setPendingNewSessionModel(null);
  }

  if (agent?.engineType === 'claude' && isConcreteModelId(agent.modelDisplay)) {
    const accountId = agent.modelAccountId?.trim() || fallbackAccountId;
    const resolved = resolveProviderRawModelId(accounts, agent.modelDisplay, accountId);
    if (
      resolved
      && isModelStillAllowedForAccount(accounts, resolved.modelId, resolved.accountId)
    ) {
      try {
        const persisted = await persistSessionModelToGateway({
          sessionKey: trimmedKey,
          model: resolved.modelId,
          accountId: resolved.accountId,
          agentId,
          engineType,
        });
        if (persisted) {
          useChatStore.setState((state) => ({
            sessions: state.sessions.map((session) => (
              session.key === trimmedKey
                ? { ...session, model: persisted }
                : session
            )),
          }));
        }
      } catch (err) {
        console.warn('[applyWorkspaceDefaultToNewSession] failed to persist Claude agent model:', err);
      }
      return;
    }
    // Delisted agent preferred → fall through to workspace default.
  }

  const rawModelId = getWorkspaceDefaultRawModelId(accounts, defaultAccountId);
  if (!rawModelId) return;

  try {
    const persisted = await persistSessionModelToGateway({
      sessionKey: trimmedKey,
      model: rawModelId,
      accountId: fallbackAccountId,
      agentId,
      engineType,
    });
    if (persisted) {
      useChatStore.setState((state) => ({
        sessions: state.sessions.map((session) => (
          session.key === trimmedKey
            ? { ...session, model: persisted }
            : session
        )),
      }));
    }
    void useChatStore.getState().loadSessions();
    void useAgentsStore.getState().fetchAgents();
  } catch (err) {
    console.warn('[applyWorkspaceDefaultToNewSession] failed:', err);
  }
}
