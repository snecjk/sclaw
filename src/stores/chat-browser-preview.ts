import { create } from 'zustand';

export interface ChatBrowserPreviewTab {
  id: string;
  url: string;
  /** Same-origin navigations update this; falls back to `url` for display. */
  currentUrl?: string;
  title: string;
  /** Bumped to remount iframe when re-navigating the same logical URL. */
  remountKey: number;
}

interface ChatBrowserPreviewState {
  tabsBySession: Record<string, ChatBrowserPreviewTab[]>;
  openRevisionBySession: Record<string, number>;
  activeTabIdBySession: Record<string, string | null>;

  openTab: (
    sessionKey: string,
    input: { url: string; title?: string; force?: boolean },
  ) => string;
  closeTab: (sessionKey: string, tabId: string) => void;
  setActiveTab: (sessionKey: string, tabId: string | null) => void;
  /** Record the iframe's current location after same-origin in-page navigation. */
  updateTabUrl: (sessionKey: string, tabId: string, url: string) => void;
  getTabs: (sessionKey: string) => ChatBrowserPreviewTab[];
  getActiveTab: (sessionKey: string) => ChatBrowserPreviewTab | null;
}

function makeTabId(): string {
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function samePreviewIdentity(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return a === b;
  }
}

export const useChatBrowserPreviewStore = create<ChatBrowserPreviewState>((set, get) => ({
  tabsBySession: {},
  openRevisionBySession: {},
  activeTabIdBySession: {},

  openTab: (sessionKey, input) => {
    const nextUrl = input.url.trim();
    if (!nextUrl) return '';
    set((state) => ({ openRevisionBySession: {
      ...state.openRevisionBySession,
      [sessionKey]: (state.openRevisionBySession[sessionKey] ?? 0) + 1,
    } }));

    const prev = get().tabsBySession[sessionKey] ?? [];
    const existing = prev.find((item) => samePreviewIdentity(item.url, nextUrl));

    if (existing) {
      const shouldRemount = input.force === true || existing.url !== nextUrl;
      if (shouldRemount) {
        set((state) => ({
          tabsBySession: {
            ...state.tabsBySession,
            [sessionKey]: (state.tabsBySession[sessionKey] ?? []).map((tab) => (
              tab.id === existing.id
                ? {
                    ...tab,
                    url: nextUrl,
                    title: input.title?.trim() || tab.title,
                    remountKey: tab.remountKey + 1,
                  }
                : tab
            )),
          },
          activeTabIdBySession: { ...state.activeTabIdBySession, [sessionKey]: existing.id },
        }));
      } else {
        set((state) => ({
          activeTabIdBySession: { ...state.activeTabIdBySession, [sessionKey]: existing.id },
        }));
      }
      return existing.id;
    }

    const tabId = makeTabId();
    const tab: ChatBrowserPreviewTab = {
      id: tabId,
      url: nextUrl,
      title: input.title?.trim() || '业务页面',
      remountKey: 0,
    };
    set((state) => {
      const list = state.tabsBySession[sessionKey] ?? [];
      return {
        tabsBySession: { ...state.tabsBySession, [sessionKey]: [...list, tab] },
        activeTabIdBySession: { ...state.activeTabIdBySession, [sessionKey]: tabId },
      };
    });
    return tabId;
  },

  closeTab: (sessionKey, tabId) => {
    set((state) => {
      const prev = state.tabsBySession[sessionKey] ?? [];
      const next = prev.filter((tab) => tab.id !== tabId);
      const active = state.activeTabIdBySession[sessionKey];
      const nextActive = active === tabId ? (next[next.length - 1]?.id ?? null) : active;
      return {
        tabsBySession: { ...state.tabsBySession, [sessionKey]: next },
        activeTabIdBySession: { ...state.activeTabIdBySession, [sessionKey]: nextActive },
      };
    });
  },

  setActiveTab: (sessionKey, tabId) => {
    set((state) => ({
      activeTabIdBySession: { ...state.activeTabIdBySession, [sessionKey]: tabId },
    }));
  },

  updateTabUrl: (sessionKey, tabId, url) => {
    set((state) => ({
      tabsBySession: {
        ...state.tabsBySession,
        [sessionKey]: (state.tabsBySession[sessionKey] ?? []).map((tab) => (
          tab.id === tabId && tab.currentUrl !== url ? { ...tab, currentUrl: url } : tab
        )),
      },
    }));
  },

  getTabs: (sessionKey) => get().tabsBySession[sessionKey] ?? [],

  getActiveTab: (sessionKey) => {
    const tabs = get().tabsBySession[sessionKey] ?? [];
    const activeId = get().activeTabIdBySession[sessionKey];
    return tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1] ?? null;
  },
}));

export function openChatBrowserPreview(input: {
  sessionKey: string;
  url: string;
  title?: string;
  force?: boolean;
}): string {
  return useChatBrowserPreviewStore.getState().openTab(input.sessionKey, input);
}
