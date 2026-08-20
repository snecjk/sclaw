/**
 * App Plaza Chrome-like multi-tab shell store.
 * Home tab is fixed; browser tabs support live/suspended/blank with a 5-live cap.
 */
import { create } from 'zustand';
import { useChatStore } from '@/stores/chat';
import {
  activateSclawBrowserEmbedChat,
  createSclawBrowserEmbedChatSession,
  deactivateSclawBrowserEmbedChat,
  deleteSclawBrowserEmbedChatSession,
  listSclawBrowserEmbedChatSessions,
  switchSclawBrowserEmbedChatSession,
} from '@/lib/sclaw-browser-chat-lifecycle';
import type { EmbedChatIndexItem } from '@/lib/sclaw-browser-chat-index';
import { createSclawBrowserEmbedRuntimeId, deriveSclawBrowserAppId } from '@/lib/sclaw-browser-chat-session';
import {
  ensureSclawBrowserBridge,
  registerSclawBrowserRuntime,
  unregisterSclawBrowserRuntime,
} from '@/lib/sclaw-browser-host-api';
import { purgeEphemeralEmbedChatForApp } from '@/lib/app-plaza-ephemeral-chat-purge';
import {
  appPlazaTabUrlsMatch,
  coerceAppPlazaNavigableUrl,
  normalizeAppPlazaTabUrl,
} from '@/lib/app-plaza-tab-url';
import { resolveSclawBrowserUrl } from '@/lib/resolve-sclaw-browser-url';
import { invokeIpc } from '@/lib/api-client';
import { isStoEmbedBrowserUrl } from '../../shared/sclaw-embed-browser';
import type { AppTone } from '@/types/more-apps';

export const APP_PLAZA_HOME_TAB_ID = 'home';
export const APP_PLAZA_MAX_LIVE_BROWSER_TABS = 5;

export type AppPlazaBrowserTabStatus = 'blank' | 'live' | 'suspended';

/** Tab for an in-progress dev-app workbench (chat + preview). */
export interface AppPlazaDevAppTab {
  id: string;
  workspaceId: string;
  title: string;
}

export interface AppPlazaBrowserTab {
  id: string;
  url: string;
  title: string;
  appId: string;
  /**
   * Original catalog / external registry id (unsanitized).
   * Used for favorite matching — must not go through session-key sanitizer.
   */
  registryAppId?: string;
  /** Catalog / My Apps — retain chat on close. Ephemeral — purge on close. */
  bound: boolean;
  status: AppPlazaBrowserTabStatus;
  lastActiveAt: number;
  embedRuntimeId: string | null;
  chatPanelOpen: boolean;
  chatSessionKey: string | null;
  savedMainSessionKey: string | null;
  chatSessions: EmbedChatIndexItem[];
  chatSplitPercent: number;
  /**
   * Favicon reported by the page itself (Electron `page-favicon-updated`).
   * Same source Chrome uses for tab icons — not the App Plaza catalog icon.
   */
  pageFaviconUrl?: string;
  /**
   * Live document URL from the webview (SPA / in-page navigation).
   * Kept separate from `url` so updating it does not remount the webview.
   */
  currentPageUrl?: string;
  /** @deprecated Prefer pageFaviconUrl for tab chrome; kept for open-from-catalog hints only. */
  iconUrl?: string;
  iconKey?: string;
  tone?: AppTone;
  /** Original target URL before auth rewrites / ticket exchange. */
  sourceUrl?: string;
  /** Subsystem code used to exchange skip-login URLs. */
  systemCode?: string;
  /** Only App Plaza catalog apps may exchange skip-login URLs. */
  skipLoginEligible?: boolean;
}

interface OpenOrFocusBrowserTabInput {
  url: string;
  title?: string;
  appId?: string;
  /** When true (plaza card / my apps), chat survives tab close. */
  bound?: boolean;
  iconUrl?: string;
  iconKey?: string;
  tone?: AppTone;
  /** Original target URL before auth rewrites / ticket exchange. */
  sourceUrl?: string;
  /** Subsystem code used to exchange skip-login URLs. */
  systemCode?: string;
  /** Only App Plaza catalog apps may exchange skip-login URLs. */
  skipLoginEligible?: boolean;
}

interface AppPlazaShellState {
  /** True while React Router is on /more-apps */
  routeActive: boolean;
  activeTabId: string;
  browserTabs: AppPlazaBrowserTab[];
  devAppTabs: AppPlazaDevAppTab[];

  setRouteActive: (active: boolean) => void;
  selectTab: (tabId: string) => void;
  addBlankTab: () => void;
  closeBrowserTab: (tabId: string) => void;
  /** Open (or focus) a dev-app workbench tab. Returns the tab id. */
  openOrFocusDevAppTab: (workspaceId: string, title: string) => string;
  closeDevAppTab: (tabId: string) => void;
  closeDevAppTabsByWorkspaceId: (workspaceId: string) => void;
  submitBlankTabUrl: (tabId: string, rawUrl: string) => void;
  /** Navigate an existing live/suspended/blank tab to a manually entered URL. */
  navigateBrowserTabUrl: (tabId: string, rawUrl: string) => void;
  openOrFocusBrowserTab: (input: OpenOrFocusBrowserTabInput) => void;
  promoteTabBound: (tabId: string, nextAppId: string, title?: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  /** Chrome-like: update title / favicon from the embedded page. */
  updateTabPageMeta: (tabId: string, meta: { title?: string; pageFaviconUrl?: string; currentPageUrl?: string }) => void;

  toggleChatPanel: (tabId?: string) => void;
  openChatPanel: (tabId?: string) => void;
  closeChatPanel: (tabId?: string) => void;
  /** Re-activate embed chat when the panel is open but global session drifted. */
  ensureEmbedChatActive: (tabId?: string) => void;
  setChatSplitPercent: (percent: number, tabId?: string) => void;
  refreshChatSessions: (tabId?: string) => void;
  createChatSession: (tabId?: string) => void;
  switchChatSession: (sessionKey: string, tabId?: string) => void;
  deleteChatSession: (sessionKey: string, tabId?: string) => Promise<void>;
}

const DEFAULT_CHAT_SPLIT_PERCENT = 28;

function createTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBlankTab(): AppPlazaBrowserTab {
  return {
    id: createTabId(),
    url: '',
    title: '新标签页',
    appId: '',
    bound: false,
    status: 'blank',
    lastActiveAt: Date.now(),
    embedRuntimeId: null,
    chatPanelOpen: false,
    chatSessionKey: null,
    savedMainSessionKey: null,
    chatSessions: [],
    chatSplitPercent: DEFAULT_CHAT_SPLIT_PERCENT,
  };
}

function countLive(tabs: AppPlazaBrowserTab[]): number {
  return tabs.filter((t) => t.status === 'live').length;
}

/** Release embed chat session back to the main sidebar without closing the panel. */
function pauseEmbedChatForTab(tab: AppPlazaBrowserTab | undefined): void {
  if (!tab?.chatPanelOpen || tab.status !== 'live') return;
  deactivateSclawBrowserEmbedChat(tab.chatSessionKey, tab.savedMainSessionKey);
}

/** Re-bind chat store to an open embed panel after route/tab changes. */
function ensureEmbedChatActiveForTab(tab: AppPlazaBrowserTab | undefined): void {
  if (
    !tab?.chatPanelOpen
    || tab.status !== 'live'
    || !tab.embedRuntimeId
    || !tab.appId
    || !tab.chatSessionKey
  ) {
    return;
  }
  if (useChatStore.getState().currentSessionKey === tab.chatSessionKey) {
    return;
  }
  void ensureSclawBrowserBridge(tab.embedRuntimeId);
  switchSclawBrowserEmbedChatSession(
    tab.appId,
    tab.embedRuntimeId,
    tab.chatSessionKey,
    tab.savedMainSessionKey,
  );
}

function syncActiveTabEmbedChat(
  previousActiveTabId: string,
  nextActiveTabId: string,
  tabs: AppPlazaBrowserTab[],
): void {
  if (previousActiveTabId === nextActiveTabId) return;
  const previous = tabs.find((t) => t.id === previousActiveTabId);
  const next = tabs.find((t) => t.id === nextActiveTabId);
  pauseEmbedChatForTab(previous);
  ensureEmbedChatActiveForTab(next);
}

/**
 * Find a reusable browser tab with system isolation.
 * - Catalog apps: prefer registryAppId (stable across one-time skip-login tickets)
 * - With systemCode: never reuse a tab from another system
 * - Without systemCode: only reuse among tabs that also lack systemCode
 */
function findReusableBrowserTab(
  tabs: AppPlazaBrowserTab[],
  opts: {
    url: string;
    registryAppId?: string;
    systemCode?: string;
    excludeTabId?: string;
  },
): AppPlazaBrowserTab | undefined {
  const registryAppId = opts.registryAppId?.trim() || '';
  const systemCode = opts.systemCode?.trim() || '';
  const candidates = opts.excludeTabId
    ? tabs.filter((t) => t.id !== opts.excludeTabId)
    : tabs;

  if (registryAppId) {
    const byRegistry = candidates.find(
      (t) => (t.registryAppId?.trim() || '') === registryAppId,
    );
    if (byRegistry) {
      const existingCode = byRegistry.systemCode?.trim() || '';
      // Hard isolation: same registry id must not cross systemCode.
      if (existingCode && systemCode && existingCode !== systemCode) {
        return undefined;
      }
      return byRegistry;
    }
  }

  if (!opts.url?.trim()) return undefined;

  if (systemCode) {
    return candidates.find(
      (t) =>
        (t.systemCode?.trim() || '') === systemCode
        && Boolean(t.url)
        && appPlazaTabUrlsMatch(t.url, opts.url),
    );
  }

  return candidates.find(
    (t) =>
      !(t.systemCode?.trim())
      && Boolean(t.url)
      && appPlazaTabUrlsMatch(t.url, opts.url),
  );
}

function pickLruSuspendCandidate(
  tabs: AppPlazaBrowserTab[],
  protectId: string,
): AppPlazaBrowserTab | null {
  const candidates = tabs
    .filter((t) => t.status === 'live' && t.id !== protectId)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  return candidates[0] ?? null;
}

async function prepareStoSessionIfNeeded(url: string): Promise<void> {
  if (window.electron && isStoEmbedBrowserUrl(url)) {
    try {
      await invokeIpc('sclaw-browser:prepareSession', { url });
    } catch {
      // Open anyway — prepare is best-effort.
    }
  }
}

function tearDownTabRuntime(tab: AppPlazaBrowserTab): AppPlazaBrowserTab {
  if (tab.embedRuntimeId) {
    void unregisterSclawBrowserRuntime(tab.embedRuntimeId);
  }
  if (tab.chatPanelOpen) {
    deactivateSclawBrowserEmbedChat(tab.chatSessionKey, tab.savedMainSessionKey);
  }
  return {
    ...tab,
    embedRuntimeId: null,
    chatPanelOpen: false,
    chatSessionKey: null,
    savedMainSessionKey: null,
  };
}

function suspendTab(tab: AppPlazaBrowserTab): AppPlazaBrowserTab {
  const cleared = tearDownTabRuntime(tab);
  return {
    ...cleared,
    status: 'suspended',
  };
}

function makeLiveTab(
  tab: AppPlazaBrowserTab,
  url: string,
  title: string,
  appId: string,
  bound: boolean,
  icons?: {
    iconUrl?: string;
    iconKey?: string;
    tone?: AppTone;
    registryAppId?: string;
    sourceUrl?: string;
    systemCode?: string;
    skipLoginEligible?: boolean;
  },
): AppPlazaBrowserTab {
  const embedRuntimeId = createSclawBrowserEmbedRuntimeId();
  void registerSclawBrowserRuntime({
    runtimeId: embedRuntimeId,
    appTitle: title,
    initialUrl: url,
    appId,
    bound,
  });
  // Catalog hints optional; pageFaviconUrl comes from webview after load (Chrome-like).
  const iconUrl = icons?.iconUrl?.trim() || tab.iconUrl;
  return {
    ...tab,
    url,
    currentPageUrl: url,
    title,
    appId,
    registryAppId: icons?.registryAppId?.trim() || tab.registryAppId,
    bound,
    status: 'live',
    lastActiveAt: Date.now(),
    embedRuntimeId,
    chatPanelOpen: false,
    chatSessionKey: null,
    savedMainSessionKey: null,
    chatSessions: listSclawBrowserEmbedChatSessions(appId),
    iconUrl,
    sourceUrl: icons?.sourceUrl?.trim() || tab.sourceUrl,
    systemCode: icons?.systemCode?.trim() || tab.systemCode,
    skipLoginEligible: icons?.skipLoginEligible ?? tab.skipLoginEligible,
    iconKey: icons?.iconKey ?? tab.iconKey,
    tone: icons?.tone ?? tab.tone,
    // Reset until the page reports its own favicon (same as Chrome).
    pageFaviconUrl: undefined,
  };
}

export const useAppPlazaShellStore = create<AppPlazaShellState>((set, get) => ({
  routeActive: false,
  activeTabId: APP_PLAZA_HOME_TAB_ID,
  browserTabs: [],
  devAppTabs: [],

  setRouteActive: (active) => {
    const state = get();
    if (active === state.routeActive) return;

    if (!active) {
      for (const tab of state.browserTabs) {
        pauseEmbedChatForTab(tab);
      }
    }
    set({ routeActive: active });
    if (active) {
      const activeTab = get().browserTabs.find((t) => t.id === get().activeTabId);
      ensureEmbedChatActiveForTab(activeTab);
    }
  },

  selectTab: (tabId) => {
    const state = get();
    const previousActiveTabId = state.activeTabId;
    if (tabId === APP_PLAZA_HOME_TAB_ID) {
      if (state.routeActive) {
        const previous = state.browserTabs.find((t) => t.id === previousActiveTabId);
        pauseEmbedChatForTab(previous);
      }
      set({ activeTabId: APP_PLAZA_HOME_TAB_ID });
      return;
    }

    // Dev-app tab — simple focus, no webview lifecycle.
    const devTab = state.devAppTabs.find((t) => t.id === tabId);
    if (devTab) {
      set({ activeTabId: tabId });
      return;
    }

    const tab = state.browserTabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (tab.status === 'suspended' && tab.url) {
      void (async () => {
        await prepareStoSessionIfNeeded(tab.url);
        set((prev) => {
          let tabs = [...prev.browserTabs];
          const idx = tabs.findIndex((t) => t.id === tabId);
          if (idx < 0) return prev;

          // Cap: suspend LRU if needed before remount
          while (countLive(tabs) >= APP_PLAZA_MAX_LIVE_BROWSER_TABS) {
            const victim = pickLruSuspendCandidate(tabs, tabId);
            if (!victim) break;
            tabs = tabs.map((t) => (t.id === victim.id ? suspendTab(t) : t));
          }

          const current = tabs[idx]!;
          const revived = makeLiveTab(
            current,
            current.url,
            current.title || current.url,
            current.appId || deriveSclawBrowserAppId({ url: current.url }),
            current.bound,
            {
              iconUrl: current.iconUrl,
              iconKey: current.iconKey,
              tone: current.tone,
              registryAppId: current.registryAppId,
              sourceUrl: current.sourceUrl,
              systemCode: current.systemCode,
              skipLoginEligible: current.skipLoginEligible,
            },
          );
          tabs[idx] = revived;
          return { browserTabs: tabs, activeTabId: tabId };
        });
      })();
      return;
    }

    const nextBrowserTabs = state.browserTabs.map((t) =>
      t.id === tabId ? { ...t, lastActiveAt: Date.now() } : t,
    );
    set({
      activeTabId: tabId,
      browserTabs: nextBrowserTabs,
    });
    if (get().routeActive) {
      syncActiveTabEmbedChat(previousActiveTabId, tabId, nextBrowserTabs);
    }
  },

  addBlankTab: () => {
    const blank = createBlankTab();
    set((prev) => ({
      browserTabs: [...prev.browserTabs, blank],
      activeTabId: blank.id,
    }));
  },

  closeBrowserTab: (tabId) => {
    const state = get();
    const tab = state.browserTabs.find((t) => t.id === tabId);
    if (!tab) return;

    const cleared = tearDownTabRuntime(tab);
    if (!tab.bound && tab.appId) {
      void purgeEphemeralEmbedChatForApp(tab.appId);
    }

    const remaining = state.browserTabs.filter((t) => t.id !== tabId);
    let nextActive = state.activeTabId;
    if (state.activeTabId === tabId) {
      const closedIndex = state.browserTabs.findIndex((t) => t.id === tabId);
      const neighbor = remaining[closedIndex] ?? remaining[closedIndex - 1] ?? null;
      nextActive = neighbor?.id ?? APP_PLAZA_HOME_TAB_ID;
    }

    // Drop unused cleared reference noise
    void cleared;
    set({ browserTabs: remaining, activeTabId: nextActive });
  },

  openOrFocusDevAppTab: (workspaceId, title) => {
    const existing = get().devAppTabs.find((t) => t.workspaceId === workspaceId);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = `devapp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const tab: AppPlazaDevAppTab = { id, workspaceId, title };
    set((prev) => ({
      devAppTabs: [...prev.devAppTabs, tab],
      activeTabId: id,
    }));
    return id;
  },

  closeDevAppTab: (tabId) => {
    const state = get();
    const remaining = state.devAppTabs.filter((t) => t.id !== tabId);
    let nextActive = state.activeTabId;
    if (state.activeTabId === tabId) {
      // Fall back to home
      nextActive = APP_PLAZA_HOME_TAB_ID;
    }
    set({ devAppTabs: remaining, activeTabId: nextActive });
  },

  closeDevAppTabsByWorkspaceId: (workspaceId) => {
    const state = get();
    const remaining = state.devAppTabs.filter((t) => t.workspaceId !== workspaceId);
    if (remaining.length === state.devAppTabs.length) return;
    const closedActive = state.devAppTabs.some(
      (t) => t.workspaceId === workspaceId && t.id === state.activeTabId,
    );
    set({
      devAppTabs: remaining,
      activeTabId: closedActive ? APP_PLAZA_HOME_TAB_ID : state.activeTabId,
    });
  },

  submitBlankTabUrl: (tabId, rawUrl) => {
    const navigable = coerceAppPlazaNavigableUrl(rawUrl);
    if (!navigable) return;
    const resolvedUrl = resolveSclawBrowserUrl(navigable);
    const title = (() => {
      try {
        return new URL(resolvedUrl).hostname || resolvedUrl;
      } catch {
        return resolvedUrl;
      }
    })();
    const appId = deriveSclawBrowserAppId({ url: resolvedUrl });

    void (async () => {
      await prepareStoSessionIfNeeded(resolvedUrl);
      set((prev) => {
        let tabs = [...prev.browserTabs];
        const idx = tabs.findIndex((t) => t.id === tabId);
        if (idx < 0) return prev;

        // Reuse existing tab with same URL only within the same system isolation boundary
        const existing = findReusableBrowserTab(tabs, {
          url: resolvedUrl,
          excludeTabId: tabId,
        });
        if (existing) {
          // Close the blank tab without purge (no appId chat yet)
          tabs = tabs.filter((t) => t.id !== tabId);
          return { browserTabs: tabs, activeTabId: existing.id };
        }

        while (countLive(tabs) >= APP_PLAZA_MAX_LIVE_BROWSER_TABS) {
          const victim = pickLruSuspendCandidate(tabs, tabId);
          if (!victim) break;
          tabs = tabs.map((t) => (t.id === victim.id ? suspendTab(t) : t));
        }

        const current = tabs[idx]!;
        tabs[idx] = makeLiveTab(current, resolvedUrl, title, appId, false, {
          registryAppId: undefined,
        });
        return { browserTabs: tabs, activeTabId: tabId };
      });
      // After reuse path, also select existing if suspended
      const after = get();
      const focus = findReusableBrowserTab(after.browserTabs, { url: resolvedUrl });
      if (focus && focus.status === 'suspended') {
        get().selectTab(focus.id);
      } else if (focus) {
        set({ activeTabId: focus.id });
      }
    })();
  },

  navigateBrowserTabUrl: (tabId, rawUrl) => {
    const tab = get().browserTabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.status === 'blank') {
      get().submitBlankTabUrl(tabId, rawUrl);
      return;
    }

    const navigable = coerceAppPlazaNavigableUrl(rawUrl);
    if (!navigable) return;
    const resolvedUrl = resolveSclawBrowserUrl(navigable);
    if (tab.url && appPlazaTabUrlsMatch(tab.url, resolvedUrl)) {
      set({ activeTabId: tabId });
      return;
    }

    const title = (() => {
      try {
        return new URL(resolvedUrl).hostname || resolvedUrl;
      } catch {
        return resolvedUrl;
      }
    })();
    // Manual address entry → ephemeral identity unless already bound to catalog/my-apps.
    const appId = tab.bound && tab.appId
      ? tab.appId
      : deriveSclawBrowserAppId({ url: resolvedUrl });
    const bound = tab.bound;

    void (async () => {
      await prepareStoSessionIfNeeded(resolvedUrl);
      set((prev) => {
        let tabs = [...prev.browserTabs];
        const idx = tabs.findIndex((t) => t.id === tabId);
        if (idx < 0) return prev;

        const existing = findReusableBrowserTab(tabs, {
          url: resolvedUrl,
          registryAppId: tab.registryAppId,
          systemCode: tab.systemCode,
          excludeTabId: tabId,
        });
        if (existing) {
          const closing = tabs[idx]!;
          const cleared = tearDownTabRuntime(closing);
          if (!closing.bound && closing.appId) {
            void purgeEphemeralEmbedChatForApp(closing.appId);
          }
          void cleared;
          tabs = tabs.filter((t) => t.id !== tabId);
          return { browserTabs: tabs, activeTabId: existing.id };
        }

        while (countLive(tabs.filter((t) => t.id !== tabId)) >= APP_PLAZA_MAX_LIVE_BROWSER_TABS) {
          const victim = pickLruSuspendCandidate(tabs, tabId);
          if (!victim) break;
          tabs = tabs.map((t) => (t.id === victim.id ? suspendTab(t) : t));
        }

        const current = tearDownTabRuntime(tabs[idx]!);
        tabs[idx] = makeLiveTab(current, resolvedUrl, title, appId, bound, {
          iconUrl: current.iconUrl,
          iconKey: current.iconKey,
          tone: current.tone,
          registryAppId: current.registryAppId,
          sourceUrl: current.sourceUrl,
          systemCode: current.systemCode,
          skipLoginEligible: current.skipLoginEligible,
        });
        return { browserTabs: tabs, activeTabId: tabId };
      });

      const focus = get().browserTabs.find((t) =>
        t.url && appPlazaTabUrlsMatch(t.url, resolvedUrl) && (
          !tab.systemCode?.trim()
          || (t.systemCode?.trim() || '') === (tab.systemCode?.trim() || '')
        ),
      );
      if (focus?.status === 'suspended') get().selectTab(focus.id);
    })();
  },

  openOrFocusBrowserTab: (input) => {
    const navigable = coerceAppPlazaNavigableUrl(input.url);
    if (!navigable) return;
    const resolvedUrl = resolveSclawBrowserUrl(navigable);
    const title = input.title?.trim() || (() => {
      try {
        return new URL(resolvedUrl).hostname || resolvedUrl;
      } catch {
        return resolvedUrl;
      }
    })();
    const bound = input.bound ?? Boolean(input.appId?.trim());
    const appId = deriveSclawBrowserAppId({ appId: input.appId, url: resolvedUrl });
    const icons = {
      iconUrl: input.iconUrl?.trim() || undefined,
      iconKey: input.iconKey,
      tone: input.tone,
      registryAppId: input.appId?.trim() || undefined,
      sourceUrl: input.sourceUrl?.trim() || undefined,
      systemCode: input.systemCode?.trim() || undefined,
      skipLoginEligible: input.skipLoginEligible ?? false,
    };

    void (async () => {
      await prepareStoSessionIfNeeded(resolvedUrl);

      const existing = findReusableBrowserTab(get().browserTabs, {
        url: resolvedUrl,
        registryAppId: icons.registryAppId,
        systemCode: icons.systemCode,
      });
      if (existing) {
        const urlChanged = !existing.url || !appPlazaTabUrlsMatch(existing.url, resolvedUrl);
        const shouldRemount = existing.status === 'suspended' || urlChanged;

        if (shouldRemount) {
          set((prev) => {
            let tabs = [...prev.browserTabs];
            const idx = tabs.findIndex((t) => t.id === existing.id);
            if (idx < 0) return prev;

            while (countLive(tabs) >= APP_PLAZA_MAX_LIVE_BROWSER_TABS) {
              const victim = pickLruSuspendCandidate(tabs, existing.id);
              if (!victim) break;
              tabs = tabs.map((t) => (t.id === victim.id ? suspendTab(t) : t));
            }

            const current = tearDownTabRuntime(tabs[idx]!);
            const nextBound = current.bound || bound;
            const nextAppId = nextBound ? appId : (current.appId || appId);
            tabs[idx] = makeLiveTab(current, resolvedUrl, title || current.title, nextAppId, nextBound, {
              iconUrl: icons.iconUrl || current.iconUrl,
              iconKey: icons.iconKey || current.iconKey,
              tone: icons.tone || current.tone,
              registryAppId: icons.registryAppId || current.registryAppId,
              // Keep each tab's system identity stable; never inherit another system's code.
              sourceUrl: icons.sourceUrl || current.sourceUrl,
              systemCode: icons.systemCode || current.systemCode,
              skipLoginEligible: icons.skipLoginEligible ?? current.skipLoginEligible,
            });
            return { browserTabs: tabs, activeTabId: existing.id };
          });
          return;
        }

        set({
          activeTabId: existing.id,
          browserTabs: get().browserTabs.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  title: title || t.title,
                  bound: t.bound || bound,
                  appId: bound ? appId : t.appId,
                  lastActiveAt: Date.now(),
                  iconUrl: icons.iconUrl || t.iconUrl,
                  iconKey: icons.iconKey || t.iconKey,
                  tone: icons.tone || t.tone,
                  registryAppId: icons.registryAppId || t.registryAppId,
                  sourceUrl: icons.sourceUrl || t.sourceUrl,
                  systemCode: icons.systemCode || t.systemCode,
                  skipLoginEligible: icons.skipLoginEligible ?? t.skipLoginEligible,
                }
              : t,
          ),
        });
        return;
      }

      set((prev) => {
        let tabs = [...prev.browserTabs];
        while (countLive(tabs) >= APP_PLAZA_MAX_LIVE_BROWSER_TABS) {
          const victim = pickLruSuspendCandidate(tabs, '');
          if (!victim) break;
          tabs = tabs.map((t) => (t.id === victim.id ? suspendTab(t) : t));
        }
        const blank = createBlankTab();
        const live = makeLiveTab(blank, resolvedUrl, title, appId, bound, icons);
        return {
          browserTabs: [...tabs, live],
          activeTabId: live.id,
        };
      });
    })();
  },

  promoteTabBound: (tabId, nextAppId, title) => {
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              bound: true,
              appId: nextAppId,
              registryAppId: nextAppId,
              title: title?.trim() || t.title,
              chatSessions: listSclawBrowserEmbedChatSessions(nextAppId),
            }
          : t,
      ),
    }));
  },

  updateTabTitle: (tabId, title) => {
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === tabId ? { ...t, title: title.trim() || t.title } : t,
      ),
    }));
  },

  updateTabPageMeta: (tabId, meta) => {
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) => {
        if (t.id !== tabId) return t;
        const nextTitle = meta.title?.trim();
        const nextFavicon = meta.pageFaviconUrl?.trim();
        const nextPageUrl = meta.currentPageUrl?.trim();
        return {
          ...t,
          title: nextTitle || t.title,
          pageFaviconUrl: nextFavicon || t.pageFaviconUrl,
          currentPageUrl: nextPageUrl || t.currentPageUrl,
        };
      }),
    }));
  },

  toggleChatPanel: (tabId) => {
    const id = tabId ?? get().activeTabId;
    const tab = get().browserTabs.find((t) => t.id === id);
    if (!tab || tab.status !== 'live') return;
    if (tab.chatPanelOpen) get().closeChatPanel(id);
    else get().openChatPanel(id);
  },

  openChatPanel: (tabId) => {
    const id = tabId ?? get().activeTabId;
    const tab = get().browserTabs.find((t) => t.id === id);
    if (!tab?.embedRuntimeId || !tab.appId || tab.status !== 'live') return;
    if (tab.chatPanelOpen) return;
    void ensureSclawBrowserBridge(tab.embedRuntimeId);
    const activation = activateSclawBrowserEmbedChat(tab.appId, tab.embedRuntimeId);
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === id
          ? {
              ...t,
              chatPanelOpen: true,
              chatSessionKey: activation.chatSessionKey,
              savedMainSessionKey: activation.savedMainSessionKey,
              chatSessions: listSclawBrowserEmbedChatSessions(tab.appId),
            }
          : t,
      ),
    }));
  },

  ensureEmbedChatActive: (tabId) => {
    if (!get().routeActive) return;
    const id = tabId ?? get().activeTabId;
    const tab = get().browserTabs.find((t) => t.id === id);
    ensureEmbedChatActiveForTab(tab);
  },

  closeChatPanel: (tabId) => {
    const id = tabId ?? get().activeTabId;
    const tab = get().browserTabs.find((t) => t.id === id);
    if (!tab?.chatPanelOpen) return;
    deactivateSclawBrowserEmbedChat(tab.chatSessionKey, tab.savedMainSessionKey);
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === id
          ? {
              ...t,
              chatPanelOpen: false,
              chatSessionKey: null,
              savedMainSessionKey: null,
            }
          : t,
      ),
    }));
  },

  setChatSplitPercent: (percent, tabId) => {
    const id = tabId ?? get().activeTabId;
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === id ? { ...t, chatSplitPercent: percent } : t,
      ),
    }));
  },

  refreshChatSessions: (tabId) => {
    const id = tabId ?? get().activeTabId;
    const tab = get().browserTabs.find((t) => t.id === id);
    if (!tab?.appId) return;
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === id
          ? { ...t, chatSessions: listSclawBrowserEmbedChatSessions(tab.appId) }
          : t,
      ),
    }));
  },

  createChatSession: (tabId) => {
    const id = tabId ?? get().activeTabId;
    const tab = get().browserTabs.find((t) => t.id === id);
    if (!tab?.embedRuntimeId || !tab.appId || !tab.chatPanelOpen) return;
    const activation = createSclawBrowserEmbedChatSession(
      tab.appId,
      tab.embedRuntimeId,
      tab.savedMainSessionKey,
    );
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === id
          ? {
              ...t,
              chatSessionKey: activation.chatSessionKey,
              chatSessions: listSclawBrowserEmbedChatSessions(tab.appId),
            }
          : t,
      ),
    }));
  },

  switchChatSession: (sessionKey, tabId) => {
    const id = tabId ?? get().activeTabId;
    const tab = get().browserTabs.find((t) => t.id === id);
    if (!tab?.embedRuntimeId || !tab.appId || !tab.chatPanelOpen) return;
    if (sessionKey === tab.chatSessionKey) return;
    const activation = switchSclawBrowserEmbedChatSession(
      tab.appId,
      tab.embedRuntimeId,
      sessionKey,
      tab.savedMainSessionKey,
    );
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === id
          ? {
              ...t,
              chatSessionKey: activation.chatSessionKey,
              chatSessions: listSclawBrowserEmbedChatSessions(tab.appId),
            }
          : t,
      ),
    }));
  },

  deleteChatSession: async (sessionKey, tabId) => {
    const id = tabId ?? get().activeTabId;
    const tab = get().browserTabs.find((t) => t.id === id);
    if (!tab?.embedRuntimeId || !tab.appId || !tab.chatPanelOpen) return;
    const activation = await deleteSclawBrowserEmbedChatSession(
      tab.appId,
      tab.embedRuntimeId,
      sessionKey,
      tab.savedMainSessionKey,
    );
    if (!activation) return;
    set((prev) => ({
      browserTabs: prev.browserTabs.map((t) =>
        t.id === id
          ? {
              ...t,
              chatSessionKey: activation.chatSessionKey,
              chatSessions: listSclawBrowserEmbedChatSessions(tab.appId),
            }
          : t,
      ),
    }));
  },
}));

export function isAppPlazaShellVisible(): boolean {
  return useAppPlazaShellStore.getState().routeActive;
}

export function findAppPlazaTabByNormalizedUrl(url: string): AppPlazaBrowserTab | undefined {
  const normalized = normalizeAppPlazaTabUrl(url);
  if (!normalized) return undefined;
  return useAppPlazaShellStore
    .getState()
    .browserTabs.find((t) => t.url && appPlazaTabUrlsMatch(t.url, url));
}
