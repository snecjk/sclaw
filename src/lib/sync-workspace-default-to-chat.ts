/**
 * After workspace default model changes in Settings, sync agents list and
 * the active chat session when it was using the previous workspace default.
 */
import { hostApiFetch } from '@/lib/host-api';
import {
  getWorkspaceDefaultModelId,
  normalizeModelIdForChat,
  shouldSyncSessionToWorkspaceDefault,
} from '@/lib/chat-model-options';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';

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

/** Apply workspace default model to a newly created session (toolbar + gateway). */
export async function applyWorkspaceDefaultToNewSession(
  sessionKey: string,
  agentId: string,
): Promise<void> {
  const trimmedKey = sessionKey.trim();
  if (!trimmedKey) return;

  // If the session already has a model (e.g. carried over from home page selection),
  // don't overwrite it with the workspace default.
  const existingSession = useChatStore.getState().sessions.find((s) => s.key === trimmedKey);
  if (existingSession?.model) return;

  const agent = useAgentsStore.getState().agents.find((item) => item.id === agentId);
  const engineType = resolveChatSessionEngineType(existingSession, agent?.engineType, trimmedKey);

  const { accounts, defaultAccountId } = useProviderStore.getState();
  const modelId = getWorkspaceDefaultModelId(accounts, defaultAccountId);
  const accountId = defaultAccountId?.trim() ?? '';
  if (!modelId || !accountId) return;

  try {
    await hostApiFetch('/api/sessions/model', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: trimmedKey,
        model: modelId,
        accountId,
        agentId: agentId.trim() || undefined,
        engineType,
      }),
    });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.key === trimmedKey
          ? { ...session, model: modelId }
          : session
      )),
    }));
    void useChatStore.getState().loadSessions();
    void useAgentsStore.getState().fetchAgents();
  } catch (err) {
    console.warn('[applyWorkspaceDefaultToNewSession] failed:', err);
  }
}
