import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sclaw-browser-host-api', () => ({
  registerSclawBrowserRuntime: vi.fn(async () => undefined),
  unregisterSclawBrowserRuntime: vi.fn(async () => undefined),
  ensureSclawBrowserBridge: vi.fn(async () => undefined),
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
} from '@/stores/app-plaza-shell';

describe('useAppPlazaShellStore live cap', () => {
  beforeEach(() => {
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
