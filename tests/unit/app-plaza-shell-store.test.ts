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
