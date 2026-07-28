/**
 * Global SClaw in-app browser drawer state.
 * Keeps underlying page mounted so tab/scroll state is preserved on close.
 */
import { create } from 'zustand';
import {
  activateSclawBrowserEmbedChat,
  createSclawBrowserEmbedChatSession,
  deactivateSclawBrowserEmbedChat,
  deleteSclawBrowserEmbedChatSession,
  listSclawBrowserEmbedChatSessions,
  switchSclawBrowserEmbedChatSession,
} from '@/lib/sclaw-browser-chat-lifecycle';
import type { EmbedChatIndexItem } from '@/lib/sclaw-browser-chat-index';
import { createSclawBrowserEmbedRuntimeId } from '@/lib/sclaw-browser-chat-session';
import {
  ensureSclawBrowserBridge,
  registerSclawBrowserRuntime,
  unregisterSclawBrowserRuntime,
} from '@/lib/sclaw-browser-host-api';

export interface SclawBrowserOverlaySession {
  appId: string;
  url: string;
  title: string;
  /** Original target URL before any skip-login exchange. */
  sourceUrl?: string;
  /** Target subsystem code for re-exchanging skip-login links. */
  systemCode?: string;
}

interface SclawBrowserOverlayState {
  session: SclawBrowserOverlaySession | null;
  /** Ephemeral id for the current drawer — binds webview ↔ bridge ↔ host API. */
  embedRuntimeId: string | null;
  chatPanelOpen: boolean;
  chatSessionKey: string | null;
  savedMainSessionKey: string | null;
  chatSplitPercent: number;
  chatSessions: EmbedChatIndexItem[];

  open: (session: SclawBrowserOverlaySession) => void;
  close: () => void;
  toggleChatPanel: () => void;
  openChatPanel: () => void;
  closeChatPanel: () => void;
  setChatSplitPercent: (percent: number) => void;
  refreshChatSessions: () => void;
  createChatSession: () => void;
  switchChatSession: (sessionKey: string) => void;
  deleteChatSession: (sessionKey: string) => Promise<void>;
}

const DEFAULT_CHAT_SPLIT_PERCENT = 28;

export const useSclawBrowserOverlayStore = create<SclawBrowserOverlayState>((set, get) => ({
  session: null,
  embedRuntimeId: null,
  chatPanelOpen: false,
  chatSessionKey: null,
  savedMainSessionKey: null,
  chatSplitPercent: DEFAULT_CHAT_SPLIT_PERCENT,
  chatSessions: [],

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
      chatSessions: listSclawBrowserEmbedChatSessions(session.appId),
    });
  },

  close: () => {
    const snapshot = get();
    const { embedRuntimeId } = snapshot;
    if (embedRuntimeId) {
      void unregisterSclawBrowserRuntime(embedRuntimeId);
    }
    deactivateSclawBrowserEmbedChat(snapshot.chatSessionKey, snapshot.savedMainSessionKey);
    set({
      session: null,
      embedRuntimeId: null,
      chatPanelOpen: false,
      chatSessionKey: null,
      savedMainSessionKey: null,
      chatSessions: [],
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
    const { embedRuntimeId, session } = get();
    if (!embedRuntimeId || !session?.appId) return;
    void ensureSclawBrowserBridge(embedRuntimeId);
    const { chatSessionKey, savedMainSessionKey } = activateSclawBrowserEmbedChat(
      session.appId,
      embedRuntimeId,
    );
    set({
      chatPanelOpen: true,
      chatSessionKey,
      savedMainSessionKey,
      chatSessions: listSclawBrowserEmbedChatSessions(session.appId),
    });
  },

  closeChatPanel: () => {
    if (!get().chatPanelOpen) return;
    const snapshot = get();
    deactivateSclawBrowserEmbedChat(snapshot.chatSessionKey, snapshot.savedMainSessionKey);
    set({
      chatPanelOpen: false,
      chatSessionKey: null,
      savedMainSessionKey: null,
    });
  },

  setChatSplitPercent: (percent) => set({ chatSplitPercent: percent }),

  refreshChatSessions: () => {
    const appId = get().session?.appId;
    if (!appId) return;
    set({ chatSessions: listSclawBrowserEmbedChatSessions(appId) });
  },

  createChatSession: () => {
    const { embedRuntimeId, session, savedMainSessionKey, chatPanelOpen } = get();
    if (!embedRuntimeId || !session?.appId || !chatPanelOpen) return;
    const activation = createSclawBrowserEmbedChatSession(
      session.appId,
      embedRuntimeId,
      savedMainSessionKey,
    );
    set({
      chatSessionKey: activation.chatSessionKey,
      chatSessions: listSclawBrowserEmbedChatSessions(session.appId),
    });
  },

  switchChatSession: (sessionKey) => {
    const { embedRuntimeId, session, savedMainSessionKey, chatPanelOpen, chatSessionKey } = get();
    if (!embedRuntimeId || !session?.appId || !chatPanelOpen) return;
    if (sessionKey === chatSessionKey) return;
    const activation = switchSclawBrowserEmbedChatSession(
      session.appId,
      embedRuntimeId,
      sessionKey,
      savedMainSessionKey,
    );
    set({
      chatSessionKey: activation.chatSessionKey,
      chatSessions: listSclawBrowserEmbedChatSessions(session.appId),
    });
  },

  deleteChatSession: async (sessionKey) => {
    const { embedRuntimeId, session, savedMainSessionKey, chatPanelOpen } = get();
    if (!embedRuntimeId || !session?.appId || !chatPanelOpen) return;
    const activation = await deleteSclawBrowserEmbedChatSession(
      session.appId,
      embedRuntimeId,
      sessionKey,
      savedMainSessionKey,
    );
    if (!activation) return;
    set({
      chatSessionKey: activation.chatSessionKey,
      chatSessions: listSclawBrowserEmbedChatSessions(session.appId),
    });
  },
}));
