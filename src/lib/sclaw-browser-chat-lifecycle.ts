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
  touchEmbedChatIndexItem,
  type EmbedChatIndexItem,
} from '@/lib/sclaw-browser-chat-index';
import {
  isSclawBrowserEmbedChatSessionForApp,
  isSclawBrowserEmbedChatSessionKey,
} from '@/lib/sclaw-browser-chat-session';
import { linkSclawBrowserChatSession } from '@/lib/sclaw-browser-host-api';
import { useChatStore } from '@/stores/chat';
import type { ChatSession } from '@/stores/chat/types';

export interface EmbedChatActivation {
  chatSessionKey: string;
  savedMainSessionKey: string;
  embedRuntimeId: string;
  appId: string;
}

function persistEmbedSessionModel(sessionKey: string, model: string, agentId?: string): void {
  void hostApiFetch('/api/sessions/model', {
    method: 'POST',
    body: JSON.stringify({
      sessionKey,
      model,
      agentId: agentId || undefined,
      engineType: 'openclaw',
    }),
  }).catch(() => {
    // Non-blocking: UI still shows inherited model; next toolbar switch will re-persist.
  });
}

function upsertChatSessionEntry(chatSessionKey: string, savedMainSessionKey: string): {
  inheritedModel?: string;
  shouldPersistInheritedModel: boolean;
} {
  const chat = useChatStore.getState();
  const existing = chat.sessions.find((session) => session.key === chatSessionKey);
  const mainSession = chat.sessions.find((session) => session.key === savedMainSessionKey);
  const mainModel = mainSession?.model?.trim() || undefined;
  const inheritedModel = mainModel || existing?.model?.trim() || undefined;
  const shouldPersistInheritedModel = Boolean(
    mainModel && mainModel !== existing?.model?.trim(),
  );

  const entry: ChatSession = {
    key: chatSessionKey,
    updatedAt: Date.now(),
    model: inheritedModel,
    engineType: existing?.engineType ?? mainSession?.engineType,
  };

  useChatStore.setState((state) => ({
    sessions: [
      ...state.sessions.filter((session) => session.key !== chatSessionKey),
      entry,
    ],
  }));

  return { inheritedModel, shouldPersistInheritedModel };
}

function activateSessionKey(
  appId: string,
  embedRuntimeId: string,
  chatSessionKey: string,
  savedMainSessionKey: string,
): EmbedChatActivation {
  const chat = useChatStore.getState();
  const { inheritedModel, shouldPersistInheritedModel } = upsertChatSessionEntry(
    chatSessionKey,
    savedMainSessionKey,
  );

  setActiveEmbedChatSessionKey(appId, chatSessionKey);
  touchEmbedChatIndexItem(appId, chatSessionKey);

  chat.switchSession(chatSessionKey);
  void linkSclawBrowserChatSession({ runtimeId: embedRuntimeId, chatSessionKey });

  if (shouldPersistInheritedModel && inheritedModel) {
    persistEmbedSessionModel(chatSessionKey, inheritedModel, chat.currentAgentId);
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
    useChatStore.setState({
      streamingText: '',
      streamingMessage: null,
      streamingMessages: [],
      streamingToolResults: [],
      streamingTools: [],
      activeRunId: null,
      error: null,
      pendingFinal: false,
    });
  }
}
