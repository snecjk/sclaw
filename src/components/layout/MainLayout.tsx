/**
 * Main Layout Component
 *
 * 省区：无整行顶栏；侧栏列顶内嵌 chrome + 白卡片与侧栏顶齐平。
 * 完整 layout：52px TitleBar + 侧栏 + main 滚动区。
 */
import { useEffect, useRef } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { isHiddenStoTaskSubitemChatSessionKey } from '@/lib/sto-task-session';
import {
  stoAppShellBodyProvincialClass,
  stoMainCardShellClass,
  stoMainCardWrapClass,
} from '@/lib/surfaces';
import { AppShellChromeOverlay } from '@/components/layout/app-shell-chrome-overlay';
import { getSidebarLayoutVariant } from '@/lib/sidebar-layout';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  const { pathname } = useLocation();
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchToAgentMainSession = useChatStore((s) => s.switchToAgentMainSession);
  const isProvincialSidebar = getSidebarLayoutVariant() === 'provincial';
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);

  const prevPathnameRef = useRef(pathname);
  const prevSessionKeyRef = useRef(currentSessionKey);

  useEffect(() => {
    const prevPathname = prevPathnameRef.current;
    const prevSessionKey = prevSessionKeyRef.current;

    const wasOnSubitem = matchPath({ path: '/tasks/:taskId/:entryId', end: true }, prevPathname);
    const nowOnSubitem = matchPath({ path: '/tasks/:taskId/:entryId', end: true }, pathname);

    // Only reset to main when the user actually *left* a task subitem route
    // without switching to another session in the same interaction. If
    // currentSessionKey changed alongside the pathname, it means the user
    // clicked a sidebar item to switch sessions deliberately; do not reset.
    if (
      wasOnSubitem &&
      !nowOnSubitem &&
      isHiddenStoTaskSubitemChatSessionKey(prevSessionKey) &&
      currentSessionKey === prevSessionKey
    ) {
      switchToAgentMainSession('main');
    }

    prevPathnameRef.current = pathname;
    prevSessionKeyRef.current = currentSessionKey;
  }, [pathname, currentSessionKey, switchToAgentMainSession]);

  if (isProvincialSidebar) {
    return (
      <div
        data-app-shell="provincial"
        data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
        className="relative flex h-screen flex-col overflow-hidden bg-[var(--sto-page-bg)]"
      >
        <AppShellChromeOverlay />
        <div className={stoAppShellBodyProvincialClass(sidebarCollapsed)}>
          <Sidebar />
          <div className={stoMainCardWrapClass(sidebarCollapsed)}>
            <main className={stoMainCardShellClass}>
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--sto-page-bg)] dark:bg-background">
      <TitleBar />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-hidden">
        <Sidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-y-contain bg-[var(--sto-page-bg)] px-[var(--sto-content-pad-x)] py-5 [overflow-anchor:none] [scrollbar-gutter:stable] dark:bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
