/**
 * Activate / tear down ephemeral drawer chat sessions (never listed in sidebar).
 */
import {
  createSclawBrowserChatSessionKey,
  isSclawBrowserEmbedChatSessionKey,
} from '@/lib/sclaw-browser-chat-session';
import { linkSclawBrowserChatSession } from '@/lib/sclaw-browser-host-api';
import { useChatStore } from '@/stores/chat';
import type { ChatSession } from '@/stores/chat/types';

export interface EmbedChatActivation {
  chatSessionKey: string;
  savedMainSessionKey: string;
  embedRuntimeId: string;
}

export function activateSclawBrowserEmbedChat(embedRuntimeId: string): EmbedChatActivation {
  const chat = useChatStore.getState();
  const savedMainSessionKey = chat.currentSessionKey;
  const chatSessionKey = createSclawBrowserChatSessionKey(embedRuntimeId);

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

  return { chatSessionKey, savedMainSessionKey, embedRuntimeId };
}

export async function purgeSclawBrowserEmbedChat(
  chatSessionKey: string | null,
  savedMainSessionKey: string | null,
): Promise<void> {
  const chat = useChatStore.getState();
  const restoreKey = savedMainSessionKey && savedMainSessionKey !== chatSessionKey
    ? savedMainSessionKey
    : chat.currentSessionKey;

  if (chatSessionKey && isSclawBrowserEmbedChatSessionKey(chatSessionKey)) {
    const state = useChatStore.getState();
    const messagesForEmbed = state.currentSessionKey === chatSessionKey
      ? state.messages
      : [];
    const hadMessages = messagesForEmbed.length > 0
      || Boolean(state.sessionLastActivity[chatSessionKey])
      || Boolean(state.sessionLabels[chatSessionKey]);

    if (state.currentSessionKey === chatSessionKey) {
      useChatStore.setState({
        messages: [],
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

    if (hadMessages) {
      await chat.deleteSession(chatSessionKey);
    } else {
      useChatStore.setState((state) => ({
        sessions: state.sessions.filter((session) => session.key !== chatSessionKey),
        sessionLabels: Object.fromEntries(
          Object.entries(state.sessionLabels).filter(([key]) => key !== chatSessionKey),
        ),
        sessionLastActivity: Object.fromEntries(
          Object.entries(state.sessionLastActivity).filter(([key]) => key !== chatSessionKey),
        ),
      }));
    }
  }

  if (restoreKey && restoreKey !== chatSessionKey) {
    const latest = useChatStore.getState();
    if (latest.currentSessionKey === chatSessionKey || !latest.currentSessionKey) {
      latest.switchSession(restoreKey);
    }
  }
}
