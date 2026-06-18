/**
 * After workspace default model changes in Settings, sync agents list and
 * the active chat session when it was using the previous workspace default.
 */
import { hostApiFetch } from '@/lib/host-api';
import {
  getWorkspaceDefaultModelId,
  getWorkspaceDefaultRawModelId,
  normalizeModelIdForChat,
  shouldSyncSessionToWorkspaceDefault,
} from '@/lib/chat-model-options';
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
        engineType: session?.engineType,
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

  const { accounts, defaultAccountId } = useProviderStore.getState();
  const accountId = defaultAccountId?.trim() ?? '';
  if (!accountId) return;

  // Use raw model ID (preserves supplier sub-prefix like "dashscope/kimi-k2.6")
  // so the value sent to backend / Gateway matches what is registered in models.json.
  const rawModelId = getWorkspaceDefaultRawModelId(accounts, defaultAccountId);
  if (!rawModelId) return;

  try {
    await hostApiFetch('/api/sessions/model', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: trimmedKey,
        model: rawModelId,
        accountId,
        agentId: agentId.trim() || undefined,
        engineType: useChatStore.getState().sessions.find((session) => session.key === trimmedKey)?.engineType,
      }),
    });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.key === trimmedKey
          ? { ...session, model: rawModelId }
          : session
      )),
    }));
    void useChatStore.getState().loadSessions();
    void useAgentsStore.getState().fetchAgents();
  } catch (err) {
    console.warn('[applyWorkspaceDefaultToNewSession] failed:', err);
  }
}
