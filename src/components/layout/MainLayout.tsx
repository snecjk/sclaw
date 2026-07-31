/**
 * Main Layout Component
 *
 * 省区：无整行顶栏；Stage 1 三列 Grid（Sidebar | 8px L0 | Workspace）。
 * Stage 2：第二列挂 SidebarResizeHandle（collapsed 时不渲染）。
 * Stage 3：split 用统一三列 Grid；preview-expanded 用 Workspace 内单列（Conversation 由页面保持挂载）。
 * 完整 layout：52px TitleBar + 侧栏 + main 滚动区。
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { isHiddenStoTaskSubitemChatSessionKey } from '@/lib/sto-task-session';
import {
  stoAppShellGridProvincialClass,
  stoAppShellSidebarGapClass,
  stoMainCardBodyClass,
  stoMainCardBodyHomeClass,
  stoMainCardBodySplitClass,
  stoMainCardShellClass,
  stoPreviewExpandedMainClass,
  stoSplitShellInsetsClass,
  stoSplitUnifiedMainClass,
  stoWorkspaceWrapClass,
} from '@/lib/surfaces';
import { formatCssPx } from '@/lib/app-shell-metrics';
import { SIDEBAR_MIN_WIDTH } from '@/lib/sidebar-resize-metrics';
import { AppShellChromeOverlay } from '@/components/layout/app-shell-chrome-overlay';
import { useAppShellLayout } from '@/components/layout/app-shell-layout-context';
import { ContentHeader } from '@/components/layout/ContentHeader';
import { ContentHeaderProvider, useContentHeaderDisplay } from '@/components/layout/content-header-context';
import { SidebarResizeHandle } from '@/components/layout/sidebar-resize-handle';
import { useSidebarResize } from '@/hooks/use-sidebar-resize';
import { getSidebarLayoutVariant } from '@/lib/sidebar-layout';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { SidebarDeleteConfirmPortal } from '@/components/layout/sidebar-delete-confirm-portal';
import { SclawBrowserHost } from '@/components/sclaw-browser/SclawBrowserHost';
import { AppPlazaShell } from '@/components/more-apps/AppPlazaShell';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

function isHomeRoute(pathname: string): boolean {
  return pathname === '/';
}

/** Scrollable page body inside provincial main card (overlay is mounted on `<main>`). */
function MainCardBody({ hideContentHeader }: { hideContentHeader: boolean }) {
  const { pathname } = useLocation();
  const { layoutMode } = useContentHeaderDisplay();
  const isHome = isHomeRoute(pathname);
  const isSplitLayout = layoutMode === 'split';
  const isPreviewExpanded = layoutMode === 'preview-expanded';

  // 三栏与双栏 body 类互斥：cn 合并时 px-[var(--sto-content-pad-x)] 可能压过 px-0，split row 会比 header 窄 ~32–40px
  if (isSplitLayout) {
    return (
      <div className={stoMainCardBodySplitClass}>
        <Outlet />
      </div>
    );
  }

  if (isPreviewExpanded) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    );
  }

  if (isHome) {
    return (
      <div className={stoMainCardBodyHomeClass}>
        <Outlet />
      </div>
    );
  }

  return (
    <div
      className={cn(
        hideContentHeader
          ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
          : stoMainCardBodyClass,
      )}
    >
      <Outlet />
    </div>
  );
}

/** 省区主卡片：三栏时 main 承担水平 inset，保证 Header 与 split row 预览列左缘一致 */
function ProvincialMainCard({ hideContentHeader }: { hideContentHeader: boolean }) {
  const { layoutMode } = useContentHeaderDisplay();
  const isSplitLayout = layoutMode === 'split';
  const isPreviewExpanded = layoutMode === 'preview-expanded';

  return (
    <main
      className={cn(
        stoMainCardShellClass,
        'relative',
        isSplitLayout
          ? cn(stoSplitShellInsetsClass, stoSplitUnifiedMainClass)
          : isPreviewExpanded
            ? cn(stoSplitShellInsetsClass, stoPreviewExpandedMainClass)
            : 'flex min-h-0 min-w-0 flex-1 flex-col',
      )}
    >
      {!hideContentHeader ? <ContentHeader /> : null}
      <MainCardBody hideContentHeader={hideContentHeader} />
      <AppPlazaShell />
      <SclawBrowserHost />
    </main>
  );
}

function isSettingsRoute(pathname: string): boolean {
  return pathname.startsWith('/settings');
}

export function MainLayout() {
  const { pathname } = useLocation();
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchToAgentMainSession = useChatStore((s) => s.switchToAgentMainSession);
  const isProvincialSidebar = getSidebarLayoutVariant() === 'provincial';
  const { snapshot, setUserCollapsed, setPreferredWidth } = useAppShellLayout();
  const isHome = isHomeRoute(pathname);
  const shellRef = useRef<HTMLDivElement>(null);

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

  const onSettingsRoute = isSettingsRoute(pathname);
  const showSidebarResize =
    isProvincialSidebar && !onSettingsRoute && !snapshot.effectiveCollapsed && snapshot.hasSidebar;

  const { isResizing, startResize, adjustWidthByKeyboard } = useSidebarResize({
    shellRef,
    preferredWidth: snapshot.sidebarPreferredWidth,
    effectiveMax: Math.max(SIDEBAR_MIN_WIDTH, snapshot.effectiveSidebarMax),
    effectiveWidth: snapshot.effectiveSidebarWidth,
    disabled: !showSidebarResize,
    onCommitWidth: (width) => {
      setPreferredWidth(width);
      if (snapshot.collapseReasons.user) {
        setUserCollapsed(false);
      }
    },
    onCommitCollapse: () => {
      setUserCollapsed(true);
    },
  });

  const shellStyle = {
    ['--sto-sidebar-effective-w' as string]: formatCssPx(snapshot.effectiveSidebarWidth),
  } as CSSProperties;

  if (isProvincialSidebar) {
    if (onSettingsRoute) {
      return (
        <div
          data-app-shell="provincial"
          data-platform={window.electron?.platform ?? 'unknown'}
          className="relative flex h-screen flex-col overflow-hidden bg-[#F1F1F3] dark:bg-background"
        >
          <AppShellChromeOverlay />
          <ContentHeaderProvider>
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Outlet />
              <AppPlazaShell />
              <SclawBrowserHost />
            </div>
          </ContentHeaderProvider>
          <SidebarDeleteConfirmPortal />
        </div>
      );
    }

    return (
      <div
        ref={shellRef}
        data-app-shell="provincial"
        data-sidebar-collapsed={snapshot.effectiveCollapsed ? 'true' : 'false'}
        data-sidebar-resizing={isResizing ? 'true' : undefined}
        className="relative flex h-screen flex-col overflow-hidden bg-[var(--sto-shell-bg)]"
        style={shellStyle}
      >
        <AppShellChromeOverlay />
        <div className={stoAppShellGridProvincialClass}>
          <Sidebar />
          {showSidebarResize ? (
            <SidebarResizeHandle
              valueNow={snapshot.effectiveSidebarWidth}
              ariaValueMin={SIDEBAR_MIN_WIDTH}
              ariaValueMax={Math.max(SIDEBAR_MIN_WIDTH, snapshot.effectiveSidebarMax)}
              isResizing={isResizing}
              onResizeStart={startResize}
              onKeyboardKey={adjustWidthByKeyboard}
            />
          ) : (
            <div className={stoAppShellSidebarGapClass} aria-hidden />
          )}
          <div className={stoWorkspaceWrapClass}>
            <ContentHeaderProvider>
              <ProvincialMainCard hideContentHeader={false} />
            </ContentHeaderProvider>
          </div>
        </div>
        <SidebarDeleteConfirmPortal />
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className="flex h-screen flex-col overflow-hidden bg-[var(--sto-page-bg)] dark:bg-background"
      style={shellStyle}
      data-sidebar-collapsed={snapshot.effectiveCollapsed ? 'true' : 'false'}
    >
      <TitleBar />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-hidden">
        {!onSettingsRoute ? <Sidebar /> : null}
        <main
          className={cn(
            'relative min-h-0 min-w-0 flex-1 [overflow-anchor:none] dark:bg-background',
            onSettingsRoute
              ? 'flex flex-col overflow-hidden bg-[#F1F1F3] dark:bg-background'
              : isHome
                ? 'flex flex-col overflow-hidden bg-[var(--sto-page-bg)] py-5'
                : 'overflow-auto overscroll-y-contain bg-[var(--sto-page-bg)] px-[var(--sto-content-pad-x)] py-5 [scrollbar-gutter:stable]',
          )}
        >
          <Outlet />
          <AppPlazaShell />
          <SclawBrowserHost />
        </main>
      </div>
      <SidebarDeleteConfirmPortal />
    </div>
  );
}
