/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { shouldRestoreMainSessionLeavingTaskSubitem } from '@/lib/sto-task-session';
import { useChatStore } from '@/stores/chat';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  const { pathname } = useLocation();
  const switchToAgentMainSession = useChatStore((s) => s.switchToAgentMainSession);

  useEffect(() => {
    const { currentSessionKey } = useChatStore.getState();
    if (!shouldRestoreMainSessionLeavingTaskSubitem(pathname, currentSessionKey)) return;
    switchToAgentMainSession('main');
  }, [pathname, switchToAgentMainSession]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--sto-page-bg)] dark:bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + main（主区画布对齐归档设计稿） */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-hidden">
        <Sidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--sto-page-bg)] px-[var(--sto-content-pad-x)] dark:bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
