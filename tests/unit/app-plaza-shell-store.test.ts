import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deactivateSclawBrowserEmbedChat,
  switchSclawBrowserEmbedChatSession,
} from '@/lib/sclaw-browser-chat-lifecycle';
import { ensureSclawBrowserBridge } from '@/lib/sclaw-browser-host-api';

vi.mock('@/lib/sclaw-browser-host-api', () => ({
  registerSclawBrowserRuntime: vi.fn(async () => ({ ok: true })),
  unregisterSclawBrowserRuntime: vi.fn(async () => ({ ok: true })),
  ensureSclawBrowserBridge: vi.fn(async () => true),
}));

vi.mock('@/lib/app-plaza-ephemeral-chat-purge', () => ({
  purgeEphemeralEmbedChatForApp: vi.fn(async () => undefined),
}));

vi.mock('@/lib/sclaw-browser-chat-lifecycle', () => ({
  activateSclawBrowserEmbedChat: vi.fn(),
  createSclawBrowserEmbedChatSession: vi.fn(),
  deactivateSclawBrowserEmbedChat: vi.fn(),
  deleteSclawBrowserEmbedChatSession: vi.fn(),
  listSclawBrowserEmbedChatSessions: vi.fn(() => []),
  switchSclawBrowserEmbedChatSession: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(async () => undefined),
}));

import {
  APP_PLAZA_HOME_TAB_ID,
  APP_PLAZA_MAX_LIVE_BROWSER_TABS,
  useAppPlazaShellStore,
  type AppPlazaBrowserTab,
} from '@/stores/app-plaza-shell';

describe('useAppPlazaShellStore live cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppPlazaShellStore.setState({
      routeActive: true,
      activeTabId: APP_PLAZA_HOME_TAB_ID,
      browserTabs: [],
    });
  });

  it('reuses tab with same normalized URL', async () => {
    useAppPlazaShellStore.getState().openOrFocusBrowserTab({
      url: 'https://example.com/app',
      title: 'A',
      appId: 'a',
      bound: true,
    });
    await vi.waitFor(() => {
      expect(useAppPlazaShellStore.getState().browserTabs).toHaveLength(1);
    });

    useAppPlazaShellStore.getState().openOrFocusBrowserTab({
      url: 'https://example.com/app/#x',
      title: 'A2',
      appId: 'a',
      bound: true,
    });
    await vi.waitFor(() => {
      expect(useAppPlazaShellStore.getState().browserTabs).toHaveLength(1);
    });
  });

  it('isolates tabs by systemCode even when skip-login URLs look similar', async () => {
    useAppPlazaShellStore.getState().openOrFocusBrowserTab({
      url: 'https://sso.example.com/Authenticate/Login?systemCode=A&code=1',
      title: 'System A',
      appId: 'app-a',
      bound: true,
      sourceUrl: 'https://a.example.com/',
      systemCode: 'SYS_A',
    });
    useAppPlazaShellStore.getState().openOrFocusBrowserTab({
      url: 'https://sso.example.com/Authenticate/Login?systemCode=B&code=2',
      title: 'System B',
      appId: 'app-b',
      bound: true,
      sourceUrl: 'https://b.example.com/',
      systemCode: 'SYS_B',
    });

    await vi.waitFor(() => {
      const tabs = useAppPlazaShellStore.getState().browserTabs;
      expect(tabs).toHaveLength(2);
      expect(tabs.map((t) => t.systemCode).sort()).toEqual(['SYS_A', 'SYS_B']);
    });
  });

  it('reuses the same catalog app tab by registryAppId across fresh skip-login tickets', async () => {
    useAppPlazaShellStore.getState().openOrFocusBrowserTab({
      url: 'https://sso.example.com/Authenticate/Login?code=old',
      title: '网点管家',
      appId: 'wangdian',
      bound: true,
      sourceUrl: 'https://wangdian.sto.cn/',
      systemCode: 'WANGDIAN',
    });
    await vi.waitFor(() => {
      expect(useAppPlazaShellStore.getState().browserTabs).toHaveLength(1);
    });

    useAppPlazaShellStore.getState().openOrFocusBrowserTab({
      url: 'https://sso.example.com/Authenticate/Login?code=new',
      title: '网点管家',
      appId: 'wangdian',
      bound: true,
      sourceUrl: 'https://wangdian.sto.cn/',
      systemCode: 'WANGDIAN',
    });

    await vi.waitFor(() => {
      const tabs = useAppPlazaShellStore.getState().browserTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0]?.systemCode).toBe('WANGDIAN');
      expect(tabs[0]?.url).toContain('code=new');
      expect(tabs[0]?.sourceUrl).toBe('https://wangdian.sto.cn/');
    });
  });

  it('does not reuse a URL-matched tab that belongs to another systemCode', async () => {
    useAppPlazaShellStore.getState().openOrFocusBrowserTab({
      url: 'https://portal.example.com/home',
      title: 'A',
      appId: 'app-a',
      bound: true,
      systemCode: 'SYS_A',
      sourceUrl: 'https://portal.example.com/home',
    });
    await vi.waitFor(() => {
      expect(useAppPlazaShellStore.getState().browserTabs).toHaveLength(1);
    });

    useAppPlazaShellStore.getState().openOrFocusBrowserTab({
      url: 'https://portal.example.com/home',
      title: 'B',
      appId: 'app-b',
      bound: true,
      systemCode: 'SYS_B',
      sourceUrl: 'https://portal.example.com/home',
    });

    await vi.waitFor(() => {
      const tabs = useAppPlazaShellStore.getState().browserTabs;
      expect(tabs).toHaveLength(2);
      expect(new Set(tabs.map((t) => t.systemCode))).toEqual(new Set(['SYS_A', 'SYS_B']));
    });
  });

  it(`keeps at most ${APP_PLAZA_MAX_LIVE_BROWSER_TABS} live tabs`, async () => {
    for (let i = 0; i < APP_PLAZA_MAX_LIVE_BROWSER_TABS + 1; i += 1) {
      useAppPlazaShellStore.getState().openOrFocusBrowserTab({
        url: `https://example.com/app-${i}`,
        title: `App ${i}`,
        appId: `app-${i}`,
        bound: true,
      });
      await vi.waitFor(() => {
        expect(
          useAppPlazaShellStore.getState().browserTabs.length,
        ).toBeGreaterThanOrEqual(i + 1 > APP_PLAZA_MAX_LIVE_BROWSER_TABS
          ? APP_PLAZA_MAX_LIVE_BROWSER_TABS + 1
          : i + 1);
      });
    }

    await vi.waitFor(() => {
      const tabs = useAppPlazaShellStore.getState().browserTabs;
      expect(tabs).toHaveLength(APP_PLAZA_MAX_LIVE_BROWSER_TABS + 1);
      expect(tabs.filter((t) => t.status === 'live')).toHaveLength(
        APP_PLAZA_MAX_LIVE_BROWSER_TABS,
      );
      expect(tabs.filter((t) => t.status === 'suspended')).toHaveLength(1);
    });
  });
});

describe('useAppPlazaShellStore embed chat route sync', () => {
  const liveTab: AppPlazaBrowserTab = {
    id: 'tab-teambition',
    url: 'https://teambition.com/',
    title: 'Teambition',
    appId: 'app-teambition',
    bound: true,
    status: 'live',
    lastActiveAt: Date.now(),
    embedRuntimeId: 'runtime-1',
    chatPanelOpen: true,
    chatSessionKey: 'agent:main:session-embed-app-teambition',
    savedMainSessionKey: 'agent:main:main',
    chatSessions: [],
    chatSplitPercent: 28,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAppPlazaShellStore.setState({
      routeActive: true,
      activeTabId: liveTab.id,
      browserTabs: [liveTab],
    });
  });

  it('pauses embed chat when leaving App Plaza route', () => {
    useAppPlazaShellStore.getState().setRouteActive(false);

    expect(deactivateSclawBrowserEmbedChat).toHaveBeenCalledWith(
      liveTab.chatSessionKey,
      liveTab.savedMainSessionKey,
    );
    expect(useAppPlazaShellStore.getState().browserTabs[0]?.chatPanelOpen).toBe(true);
  });

  it('resumes embed chat when returning to App Plaza route', () => {
    useAppPlazaShellStore.getState().setRouteActive(false);
    vi.mocked(switchSclawBrowserEmbedChatSession).mockReturnValue({
      chatSessionKey: liveTab.chatSessionKey!,
      savedMainSessionKey: liveTab.savedMainSessionKey!,
      embedRuntimeId: liveTab.embedRuntimeId!,
      appId: liveTab.appId,
    });

    useAppPlazaShellStore.getState().setRouteActive(true);

    expect(ensureSclawBrowserBridge).toHaveBeenCalledWith(liveTab.embedRuntimeId);
    expect(switchSclawBrowserEmbedChatSession).toHaveBeenCalledWith(
      liveTab.appId,
      liveTab.embedRuntimeId,
      liveTab.chatSessionKey,
      liveTab.savedMainSessionKey,
    );
  });

  it('keeps embed chat open when navigating the same tab to a new preview link', async () => {
    useAppPlazaShellStore.getState().navigateBrowserTabUrl(
      liveTab.id,
      'https://vip.sto.cn/clawQuotation?ossKey=test-oss-key',
      { force: true },
    );

    await vi.waitFor(() => {
      const tab = useAppPlazaShellStore.getState().browserTabs[0];
      expect(tab?.url).toContain('clawQuotation');
      expect(tab?.embedRuntimeId).not.toBe(liveTab.embedRuntimeId);
      expect(tab?.chatPanelOpen).toBe(true);
      expect(tab?.chatSessionKey).toBe(liveTab.chatSessionKey);
    });

    const remounted = useAppPlazaShellStore.getState().browserTabs[0]!;

    expect(deactivateSclawBrowserEmbedChat).toHaveBeenCalledWith(
      liveTab.chatSessionKey,
      liveTab.savedMainSessionKey,
    );
    expect(switchSclawBrowserEmbedChatSession).toHaveBeenCalledWith(
      liveTab.appId,
      remounted.embedRuntimeId,
      liveTab.chatSessionKey,
      liveTab.savedMainSessionKey,
    );
  });
});
