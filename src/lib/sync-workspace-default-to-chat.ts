/**
 * After workspace default model changes in Settings, sync agents list and
 * the active chat session when it was using the previous workspace default.
 */
import { hostApiFetch } from '@/lib/host-api';
import {
  getWorkspaceDefaultRawModelId,
  normalizeModelIdForChat,
  resolveProviderRawModelId,
  shouldSyncSessionToWorkspaceDefault,
} from '@/lib/chat-model-options';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import type { ChatEngineType } from '@/lib/resolve-chat-session-engine-type';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

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
      const persisted = await persistSessionModelToGateway({
        sessionKey: trimmedKey,
        model: userChosenModel,
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
    } catch (err) {
      console.warn('[applyWorkspaceDefaultToNewSession] failed to persist user-chosen model:', err);
    }
    useChatStore.getState().setPendingNewSessionModel(null);
    return;
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
