/**
 * Global SClaw in-app browser drawer state.
 * Keeps underlying page mounted so tab/scroll state is preserved on close.
 */
import { create } from 'zustand';
import {
  activateSclawBrowserEmbedChat,
  purgeSclawBrowserEmbedChat,
} from '@/lib/sclaw-browser-chat-lifecycle';
import { createSclawBrowserEmbedRuntimeId } from '@/lib/sclaw-browser-chat-session';
import { registerSclawBrowserRuntime, unregisterSclawBrowserRuntime } from '@/lib/sclaw-browser-host-api';

export interface SclawBrowserOverlaySession {
  url: string;
  title: string;
}

interface SclawBrowserOverlayState {
  session: SclawBrowserOverlaySession | null;
  /** Stable id for the current drawer — binds webview ↔ chat session ↔ host API. */
  embedRuntimeId: string | null;
  chatPanelOpen: boolean;
  chatSessionKey: string | null;
  savedMainSessionKey: string | null;
  chatSplitPercent: number;

  open: (session: SclawBrowserOverlaySession) => void;
  close: () => void;
  toggleChatPanel: () => void;
  openChatPanel: () => void;
  closeChatPanel: () => void;
  setChatSplitPercent: (percent: number) => void;
}

const DEFAULT_CHAT_SPLIT_PERCENT = 38;

async function teardownChat(state: Pick<SclawBrowserOverlayState, 'chatSessionKey' | 'savedMainSessionKey'>) {
  await purgeSclawBrowserEmbedChat(state.chatSessionKey, state.savedMainSessionKey);
}

export const useSclawBrowserOverlayStore = create<SclawBrowserOverlayState>((set, get) => ({
  session: null,
  embedRuntimeId: null,
  chatPanelOpen: false,
  chatSessionKey: null,
  savedMainSessionKey: null,
  chatSplitPercent: DEFAULT_CHAT_SPLIT_PERCENT,

  open: (session) => {
    const embedRuntimeId = createSclawBrowserEmbedRuntimeId();
    void registerSclawBrowserRuntime({
      runtimeId: embedRuntimeId,
      appTitle: session.title,
      initialUrl: session.url,
    });
    set({
      session,
      embedRuntimeId,
      chatPanelOpen: false,
      chatSessionKey: null,
      savedMainSessionKey: null,
    });
  },

  close: () => {
    const snapshot = get();
    const { embedRuntimeId } = snapshot;
    if (embedRuntimeId) {
      void unregisterSclawBrowserRuntime(embedRuntimeId);
    }
    void teardownChat(snapshot).finally(() => {
      set({
        session: null,
        embedRuntimeId: null,
        chatPanelOpen: false,
        chatSessionKey: null,
        savedMainSessionKey: null,
      });
    });
  },

  toggleChatPanel: () => {
    const { chatPanelOpen } = get();
    if (chatPanelOpen) {
      get().closeChatPanel();
    } else {
      get().openChatPanel();
    }
  },

  openChatPanel: () => {
    if (get().chatPanelOpen) return;
    const embedRuntimeId = get().embedRuntimeId;
    if (!embedRuntimeId) return;
    const { chatSessionKey, savedMainSessionKey } = activateSclawBrowserEmbedChat(embedRuntimeId);
    set({
      chatPanelOpen: true,
      chatSessionKey,
      savedMainSessionKey,
    });
  },

  closeChatPanel: () => {
    if (!get().chatPanelOpen) return;
    const snapshot = get();
    void teardownChat(snapshot).finally(() => {
      set({
        chatPanelOpen: false,
        chatSessionKey: null,
        savedMainSessionKey: null,
      });
    });
  },

  setChatSplitPercent: (percent) => set({ chatSplitPercent: percent }),
}));
