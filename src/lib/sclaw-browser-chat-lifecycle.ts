/**
 * Activate / deactivate embed-browser chat sessions.
 * Sessions persist per app and stay hidden from the sidebar session list.
 */
import {
  createSclawBrowserChatSessionKeyForApp,
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

export function activateSclawBrowserEmbedChat(appId: string, embedRuntimeId: string): EmbedChatActivation {
  const chat = useChatStore.getState();
  const savedMainSessionKey = chat.currentSessionKey;
  const chatSessionKey = createSclawBrowserChatSessionKeyForApp(appId);

  const entry: ChatSession = {
    key: chatSessionKey,
    updatedAt: Date.now(),
  };

  useChatStore.setState((state) => ({
    sessions: [
      ...state.sessions.filter((session) => session.key !== chatSessionKey),
      entry,
    ],
  }));

  chat.switchSession(chatSessionKey);
  void linkSclawBrowserChatSession({ runtimeId: embedRuntimeId, chatSessionKey });

  return { chatSessionKey, savedMainSessionKey, embedRuntimeId, appId };
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
