/**
 * App Plaza multi-tab shell — kept mounted under MainLayout for route keep-alive.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppPlazaTabStrip } from './AppPlazaTabStrip';
import { AppPlazaBrowserPane } from './AppPlazaBrowserPane';
import { AppPlazaDevAppPane } from './AppPlazaDevAppPane';
import { MoreAppsPage } from './MoreAppsPage';
import {
  APP_PLAZA_HOME_TAB_ID,
  useAppPlazaShellStore,
} from '@/stores/app-plaza-shell';
import { bindAppNavigate, unbindAppNavigate } from '@/lib/app-navigate';
import { closeSclawBrowser } from '@/lib/open-sclaw-browser';
import { useSclawBrowserChatShortcut } from '@/components/sclaw-browser/use-sclaw-browser-chat-shortcut';
import { useSclawBrowserDevToolsShortcut } from '@/components/sclaw-browser/use-sclaw-browser-devtools-shortcut';
import { useSclawBrowserOpenUrl } from '@/components/sclaw-browser/use-sclaw-browser-open-url';
import { installJsBridgeHostListeners } from '@/lib/jsbridge/host-router';
import './app-plaza-shell.css';

export function AppPlazaShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeActive = pathname.startsWith('/more-apps');
  const setRouteActive = useAppPlazaShellStore((s) => s.setRouteActive);
  const activeTabId = useAppPlazaShellStore((s) => s.activeTabId);
  const browserTabs = useAppPlazaShellStore((s) => s.browserTabs);
  const devAppTabs = useAppPlazaShellStore((s) => s.devAppTabs);
  const toggleChatPanel = useAppPlazaShellStore((s) => s.toggleChatPanel);

  useEffect(() => {
    setRouteActive(routeActive);
  }, [routeActive, setRouteActive]);

  // Plaza multi-tab owns browsing — never leave the legacy drawer backdrop on top.
  useEffect(() => {
    if (routeActive) closeSclawBrowser();
  }, [routeActive]);

  useEffect(() => {
    bindAppNavigate(navigate);
    return () => unbindAppNavigate(navigate);
  }, [navigate]);

  // Keep listening while shell is mounted (including hidden keep-alive) so
  // guest window.open still opens plaza tabs when the shell is not visible.
  useSclawBrowserOpenUrl(true);

  useEffect(() => installJsBridgeHostListeners(), []);

  const activeBrowser = browserTabs.find((t) => t.id === activeTabId);
  const activeDevApp = devAppTabs.find((t) => t.id === activeTabId);
  const isHomeActive = activeTabId === APP_PLAZA_HOME_TAB_ID;
  const chatShortcutEnabled = routeActive && activeBrowser?.status === 'live';
  useSclawBrowserChatShortcut(Boolean(chatShortcutEnabled), () => {
    if (activeBrowser) toggleChatPanel(activeBrowser.id);
  });
  useSclawBrowserDevToolsShortcut(
    Boolean(chatShortcutEnabled),
    activeBrowser?.embedRuntimeId,
  );
  // Blur focus when hiding so keys don't hit hidden webviews
  useEffect(() => {
    if (!routeActive && document.activeElement instanceof HTMLElement) {
      const el = document.activeElement;
      if (el.closest?.('.app-plaza-shell')) {
        el.blur();
      }
    }
  }, [routeActive]);

  return (
    <div
      className={routeActive ? 'app-plaza-shell app-plaza-shell--visible' : 'app-plaza-shell app-plaza-shell--hidden'}
      aria-hidden={!routeActive}
      data-app-plaza-shell={routeActive ? 'visible' : 'hidden'}
    >
      <AppPlazaTabStrip />
      <div className="app-plaza-shell__body">
        {/* Browser stack first (under); stays mounted for keep-alive. */}
        <div
          className={
            isHomeActive || activeDevApp
              ? 'app-plaza-shell__browser-stack app-plaza-shell__browser-stack--behind-home'
              : 'app-plaza-shell__browser-stack'
          }
          aria-hidden={Boolean(isHomeActive || activeDevApp)}
          inert={isHomeActive || activeDevApp ? true : undefined}
        >
          {browserTabs.map((tab) => (
            <AppPlazaBrowserPane
              key={tab.id}
              tab={tab}
              active={activeTabId === tab.id}
            />
          ))}
        </div>

        {/* Dev-app workbench stack — same keep-alive / layering as browser tabs. */}
        <div
          className={
            activeDevApp
              ? 'app-plaza-shell__dev-app-stack'
              : 'app-plaza-shell__dev-app-stack app-plaza-shell__dev-app-stack--behind'
          }
          aria-hidden={!activeDevApp}
          inert={!activeDevApp ? true : undefined}
        >
          {devAppTabs.map((tab) => (
            <AppPlazaDevAppPane
              key={tab.id}
              tab={tab}
              active={activeTabId === tab.id}
            />
          ))}
        </div>

        {/* Home last so it wins paint + hit-testing when visible. */}
        <div
          className="app-plaza-shell__home"
          hidden={!isHomeActive}
          aria-hidden={!isHomeActive}
        >
          <div className="app-plaza-shell__home-scroll">
            <MoreAppsPage />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Route placeholder — real UI lives in AppPlazaShell (MainLayout keep-alive). */
export function AppPlazaRouteSlot() {
  return null;
}
