/**
 * Activate / deactivate embed-browser chat sessions.
 * Sessions persist per app (multi-conversation) and stay hidden from the sidebar.
 */
import { hostApiFetch } from '@/lib/host-api';
import {
  createEmbedChatIndexItem,
  getActiveEmbedChatSessionKey,
  listEmbedChatIndex,
  removeEmbedChatIndexItem,
  setActiveEmbedChatSessionKey,
  type EmbedChatIndexItem,
} from '@/lib/sclaw-browser-chat-index';
import {
  isSclawBrowserEmbedChatSessionForApp,
  isSclawBrowserEmbedChatSessionKey,
} from '@/lib/sclaw-browser-chat-session';
import { linkSclawBrowserChatSession } from '@/lib/sclaw-browser-host-api';
import {
  resolveUnusedEmbedChatEngineType,
  type ChatEngineType,
} from '@/lib/resolve-chat-session-engine-type';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { getCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import type { ChatSession } from '@/stores/chat/types';

export interface EmbedChatActivation {
  chatSessionKey: string;
  savedMainSessionKey: string;
  embedRuntimeId: string;
  appId: string;
}

function resolveCurrentAgentEngineType(agentId?: string | null): ChatEngineType {
  const agents = useAgentsStore.getState().agents;
  const normalized = (agentId || useChatStore.getState().currentAgentId || 'main').trim().toLowerCase();
  const agent = agents.find((item) => item.id.trim().toLowerCase() === normalized);
  return resolveUnusedEmbedChatEngineType(agent?.engineType);
}

function persistEmbedSessionModel(
  sessionKey: string,
  model: string,
  options: { agentId?: string; engineType: ChatEngineType },
): void {
  void hostApiFetch('/api/sessions/model', {
    method: 'POST',
    body: JSON.stringify({
      sessionKey,
      model,
      agentId: options.agentId || undefined,
      engineType: options.engineType,
    }),
  }).catch(() => {
    // Non-blocking: UI still shows inherited model; next toolbar switch will re-persist.
  });
}

function upsertChatSessionEntry(chatSessionKey: string, savedMainSessionKey: string): {
  inheritedModel?: string;
  shouldPersistInheritedModel: boolean;
  engineType: ChatEngineType;
} {
  const chat = useChatStore.getState();
  const existing = chat.sessions.find((session) => session.key === chatSessionKey);
  const mainSession = chat.sessions.find((session) => session.key === savedMainSessionKey);
  const mainModel = mainSession?.model?.trim() || undefined;
  const inheritedModel = mainModel || existing?.model?.trim() || undefined;
  const shouldPersistInheritedModel = Boolean(
    mainModel && mainModel !== existing?.model?.trim(),
  );

  // Never inherit engineType from the previous non-embed session. Toolbar shows the
  // agent default for unused embeds; falling back to mainSession.engineType is what
  // caused Claude-looking UI to send via OpenClaw and hit "Gateway not connected".
  const agentEngineType = resolveCurrentAgentEngineType(chat.currentAgentId);
  const looksUsed = Boolean(
    chat.sessionLabels[chatSessionKey]?.trim()
    || chat.sessionLastActivity[chatSessionKey],
  );
  const engineType = looksUsed
    && (existing?.engineType === 'claude' || existing?.engineType === 'openclaw')
    ? existing.engineType
    : agentEngineType;

  const entry: ChatSession = {
    key: chatSessionKey,
    updatedAt: Date.now(),
    model: inheritedModel,
    engineType,
  };

  useChatStore.setState((state) => ({
    sessions: [
      ...state.sessions.filter((session) => session.key !== chatSessionKey),
      entry,
    ],
  }));

  return { inheritedModel, shouldPersistInheritedModel, engineType };
}

function reconcileUnusedEmbedEngineType(chatSessionKey: string): ChatEngineType {
  const state = useChatStore.getState();
  if (state.currentSessionKey !== chatSessionKey) {
    const session = state.sessions.find((item) => item.key === chatSessionKey);
    return session?.engineType === 'claude' ? 'claude' : 'openclaw';
  }
  if (getCurrentChatDisplayMessages().length > 0) {
    const session = state.sessions.find((item) => item.key === chatSessionKey);
    return session?.engineType === 'claude' ? 'claude' : resolveCurrentAgentEngineType(state.currentAgentId);
  }

  const agentEngineType = resolveCurrentAgentEngineType(state.currentAgentId);
  useChatStore.setState((current) => ({
    sessions: current.sessions.map((session) => (
      session.key === chatSessionKey
        ? { ...session, engineType: agentEngineType }
        : session
    )),
  }));
  return agentEngineType;
}

function activateSessionKey(
  appId: string,
  embedRuntimeId: string,
  chatSessionKey: string,
  savedMainSessionKey: string,
): EmbedChatActivation {
  const chat = useChatStore.getState();
  const { inheritedModel, shouldPersistInheritedModel, engineType } = upsertChatSessionEntry(
    chatSessionKey,
    savedMainSessionKey,
  );

  setActiveEmbedChatSessionKey(appId, chatSessionKey);

  chat.switchSession(chatSessionKey);
  void linkSclawBrowserChatSession({ runtimeId: embedRuntimeId, chatSessionKey });

  // After history settles, empty embeds are snapped to the agent default so a stale
  // OpenClaw registry/session stamp cannot diverge from the Claude Agent toolbar.
  void useChatStore.getState().loadHistory(true).then(() => {
    const resolvedEngine = reconcileUnusedEmbedEngineType(chatSessionKey);
    if (shouldPersistInheritedModel && inheritedModel) {
      persistEmbedSessionModel(chatSessionKey, inheritedModel, {
        agentId: useChatStore.getState().currentAgentId,
        engineType: resolvedEngine,
      });
    }
  });

  // Persist immediately with the best-known engine; reconcile may re-POST if needed.
  if (shouldPersistInheritedModel && inheritedModel) {
    persistEmbedSessionModel(chatSessionKey, inheritedModel, {
      agentId: chat.currentAgentId,
      engineType,
    });
  }

  return { chatSessionKey, savedMainSessionKey, embedRuntimeId, appId };
}

/** Open last active conversation for this app (or create the first one). */
export function activateSclawBrowserEmbedChat(appId: string, embedRuntimeId: string): EmbedChatActivation {
  const chat = useChatStore.getState();
  const savedMainSessionKey = chat.currentSessionKey;
  const chatSessionKey = getActiveEmbedChatSessionKey(appId);
  return activateSessionKey(appId, embedRuntimeId, chatSessionKey, savedMainSessionKey);
}

/** Create a fresh conversation under the same app and switch to it. */
export function createSclawBrowserEmbedChatSession(
  appId: string,
  embedRuntimeId: string,
  savedMainSessionKey: string | null,
): EmbedChatActivation {
  const chat = useChatStore.getState();
  const restoreKey = savedMainSessionKey ?? chat.currentSessionKey;
  const { item } = createEmbedChatIndexItem(appId);
  return activateSessionKey(appId, embedRuntimeId, item.key, restoreKey);
}

/** Switch to an existing conversation for this app. */
export function switchSclawBrowserEmbedChatSession(
  appId: string,
  embedRuntimeId: string,
  sessionKey: string,
  savedMainSessionKey: string | null,
): EmbedChatActivation {
  const chat = useChatStore.getState();
  const restoreKey = savedMainSessionKey ?? chat.currentSessionKey;
  return activateSessionKey(appId, embedRuntimeId, sessionKey, restoreKey);
}

export function listSclawBrowserEmbedChatSessions(appId: string): EmbedChatIndexItem[] {
  const index = listEmbedChatIndex(appId);
  const chat = useChatStore.getState();
  return index.items.map((item) => {
    const label = chat.sessionLabels[item.key]?.trim();
    return label ? { ...item, title: label } : item;
  });
}

/**
 * Delete one embed conversation. If it was the last one, open a fresh empty session.
 * Activates the next key before tombstoning the deleted session in chat store.
 */
export async function deleteSclawBrowserEmbedChatSession(
  appId: string,
  embedRuntimeId: string,
  sessionKey: string,
  savedMainSessionKey: string | null,
): Promise<EmbedChatActivation | null> {
  if (!isSclawBrowserEmbedChatSessionForApp(sessionKey, appId)) {
    return null;
  }

  const chat = useChatStore.getState();
  const restoreKey = savedMainSessionKey ?? chat.currentSessionKey;
  const { nextActiveKey } = removeEmbedChatIndexItem(appId, sessionKey);

  const activation = activateSessionKey(appId, embedRuntimeId, nextActiveKey, restoreKey);

  // Best-effort: remove from sidebar list / optimistic tombstone without blocking UI.
  if (sessionKey !== nextActiveKey) {
    void chat.deleteSession(sessionKey, { skipSessionRefresh: true }).catch(() => {
      // Index/UI already moved on; gateway tombstone is optional.
    });
  }

  return activation;
}

/** Leave embed chat UI without deleting persisted history. */
export function deactivateSclawBrowserEmbedChat(
  chatSessionKey: string | null,
  savedMainSessionKey: string | null,
): void {
  const chat = useChatStore.getState();
  const restoreKey = savedMainSessionKey && savedMainSessionKey !== chatSessionKey
    ? savedMainSessionKey
    : chat.currentSessionKey;

  if (!chatSessionKey || !isSclawBrowserEmbedChatSessionKey(chatSessionKey)) {
    if (restoreKey && restoreKey !== chat.currentSessionKey) {
      chat.switchSession(restoreKey);
    }
    return;
  }

  if (chat.currentSessionKey === chatSessionKey && restoreKey && restoreKey !== chatSessionKey) {
    chat.switchSession(restoreKey);
    return;
  }

  if (chat.currentSessionKey === chatSessionKey && !restoreKey) {
    useChatRuntimeV2Store.getState().clearOverlay(chatSessionKey);
  }
}
