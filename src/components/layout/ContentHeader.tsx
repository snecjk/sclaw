/**
 * ContentHeader — 省区主内容白卡片顶部 44px 全局标题栏。
 *
 * conversation：左=侧栏展开钮+会话 chip，右=chatActions + previewActions。
 * split：真实连续 44px Header（内嵌三列 grid 对齐 body）；左列=title+chatActions，右列=预览 tab+previewActions。
 * preview-expanded：全宽 Header；页签/标题 + previewActions（含 Preview restore，≠ Sidebar restore）。
 * macOS 侧栏收起时 pad-start 走 CSS 变量，避让红绿灯。
 */
import { isValidElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isDataManageCreateRoute } from '@/lib/app-shell-metrics';
import {
  contentHeaderBarClass,
  contentHeaderBarFlushClass,
  contentHeaderPreviewExpandedStartClass,
  contentHeaderSplitBarClass,
  contentHeaderSplitChatZoneClass,
  contentHeaderSplitPreviewZoneClass,
  contentHeaderTitleClass,
  contentHeaderTitleGroupClass,
  stoSplitGridHeaderChatClass,
  stoSplitGridHeaderPreviewClass,
} from '@/lib/surfaces';
import { ContentHeaderSessionChip } from '@/components/layout/content-header-session-chip';
import { useContentHeaderDisplay } from '@/components/layout/content-header-context';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';
import { SidebarTooltip } from '@/components/layout/sidebar-tooltip';
import { useAppShellLayout } from '@/components/layout/app-shell-layout-context';
import { useChatStore } from '@/stores/chat';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import { useWorkflowUiStore } from '@/stores/workflow-ui';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { WindowsWindowControls } from '@/components/layout/windows-window-controls';
import { useWindowsChromeOwner } from '@/hooks/use-windows-chrome-owner';

export function ContentHeader() {
  const { t } = useTranslation('common');
  const {
    title,
    previewTabs,
    chatActions,
    previewActions,
    layoutMode,
    onCloseSession,
  } = useContentHeaderDisplay();
  const navigate = useNavigate();
  const location = useLocation();
  const { snapshot, setUserCollapsed } = useAppShellLayout();
  const sidebarCollapsed = snapshot.effectiveCollapsed;
  const canUserRestoreSidebar = snapshot.canUserRestoreSidebar;
  const workflowEditorActive = useWorkflowUiStore((s) => s.editorActive);
  const pageEmbedActive = isDataManageCreateRoute(location.pathname);
  const browserOverlayOpen = useSclawBrowserOverlayStore((s) => s.session !== null);
  const appPlazaVisible = useAppPlazaShellStore((s) => s.routeActive);
  const windowsChromeOwner = useWindowsChromeOwner();

  // Drawer / App Plaza 自带页顶栏，不占 44px ContentHeader。
  if (browserOverlayOpen || appPlazaVisible) {
    return null;
  }

  const isSplitLayout = layoutMode === 'split';
  const isPreviewOverlay = layoutMode === 'preview-overlay';
  const isPreviewExpanded = layoutMode === 'preview-expanded';

  const titleText = typeof title === 'string' ? title : null;
  const showTitle = title != null && title !== '';

  const titleZone = (
    <div
      className={cn(
        contentHeaderTitleGroupClass,
        // 三栏只允许继续收缩，不得取消 max-w-[min(34vw,280px)]（与两栏一致）
        isSplitLayout && 'min-w-0 shrink',
        isSplitLayout && 'overflow-hidden',
        (workflowEditorActive || pageEmbedActive) && showTitle && 'max-w-none min-w-0 flex-1',
        !showTitle && !sidebarCollapsed && 'min-w-0',
        isPreviewExpanded && 'min-w-0 max-w-none',
        isPreviewExpanded && !canUserRestoreSidebar && 'w-0 gap-0',
      )}
    >
      {canUserRestoreSidebar ? (
        <>
          <SidebarHeaderToggle
            isCollapsed
            isContentHeaderCompact
            onToggle={() => setUserCollapsed(false)}
            collapseLabel={t('sidebar.toggleSidebarCollapse')}
            expandLabel={t('sidebar.toggleSidebarExpand')}
          />
          <SidebarTooltip label={t('sidebar.newChat')} sideOffset={8}>
            <button
              type="button"
              aria-label={t('sidebar.newChat')}
              data-sclaw-browser-sidebar-preserve="true"
              onClick={() => {
                navigateToMainChatHome(navigate, location.pathname, () => {
                  useChatStore.getState().newSession();
                });
              }}
              className="sto-navigation-item no-drag flex h-[var(--sto-content-header-control-h,28px)] w-[var(--sto-content-header-control-h,28px)] shrink-0 items-center justify-center rounded-md text-[var(--sto-icon-tertiary)] transition-colors hover:text-[var(--sto-icon-secondary)]"
            >
              <MessageSquarePlus className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
            </button>
          </SidebarTooltip>
        </>
      ) : null}
      <div
        data-slot="conversation-title"
        className={cn('min-w-0 overflow-hidden', isPreviewExpanded && 'hidden')}
        aria-hidden={isPreviewExpanded || undefined}
        {...(isPreviewExpanded ? { inert: true as const } : {})}
      >
        {showTitle ? (
          titleText && onCloseSession ? (
            <ContentHeaderSessionChip label={titleText} onClose={onCloseSession} />
          ) : (
            <div className={contentHeaderTitleClass} title={titleText ?? undefined}>
              {isValidElement(title) ? title : titleText}
            </div>
          )
        ) : null}
      </div>
    </div>
  );

  /** 会话区操作（搜索/刷新/思考）：三栏时贴对话列右缘，单栏时并入右上角 */
  const chatActionsZone = chatActions ? (
    <div
      data-slot="chat-actions"
      className={cn(
        'no-drag flex shrink-0 items-center gap-1',
        isPreviewExpanded && 'hidden',
      )}
      aria-hidden={isPreviewExpanded || undefined}
      {...(isPreviewExpanded ? { inert: true as const } : {})}
    >
      {chatActions}
    </div>
  ) : null;

  const previewActionsZone = previewActions ? (
    <div data-slot="workspace-actions" className="no-drag flex shrink-0 items-center gap-1">
      {previewActions}
    </div>
  ) : null;

  const chatHeaderZone = (
    <div
      data-slot="chat-header-zone"
      className={cn(
        isSplitLayout
          ? cn(stoSplitGridHeaderChatClass, contentHeaderSplitChatZoneClass)
          : isPreviewExpanded
            ? cn(
                'flex min-w-0 shrink-0 items-center gap-2 overflow-hidden',
                !canUserRestoreSidebar && 'w-0 gap-0',
              )
            : 'flex min-w-0 flex-1 items-center gap-2 overflow-hidden',
      )}
    >
      <div
        data-slot="sidebar-title"
        className={cn(
          'min-w-0',
          isSplitLayout ? 'flex-1 overflow-hidden' : 'shrink-0',
        )}
      >
        {titleZone}
      </div>
      <div
        className={cn(
          'min-w-0 flex-1',
          (isSplitLayout || isPreviewExpanded) && 'hidden',
        )}
        aria-hidden
      />
      {chatActionsZone}
    </div>
  );

  const previewHeaderZone = (
    <div
      data-slot="preview-header-zone"
      id={isPreviewOverlay ? 'sto-preview-overlay-header' : undefined}
      className={cn(
        isSplitLayout
          ? cn(stoSplitGridHeaderPreviewClass, contentHeaderSplitPreviewZoneClass)
          : isPreviewExpanded
            ? 'flex min-w-0 flex-1 items-center gap-1 overflow-hidden'
            : 'flex min-w-0 shrink-0 items-center gap-1 overflow-hidden',
      )}
    >
      {isSplitLayout || isPreviewExpanded || isPreviewOverlay ? (
        <div data-slot="preview-tabs" className="flex min-w-0 flex-1 items-center overflow-hidden">
          {previewTabs}
        </div>
      ) : null}
      {previewActionsZone}
      {windowsChromeOwner === 'content-header' ? <WindowsWindowControls /> : null}
    </div>
  );

  return (
    <header
      data-layout-mode={layoutMode}
      className={cn(
        isSplitLayout
          ? contentHeaderSplitBarClass
          : pageEmbedActive
            ? contentHeaderBarFlushClass
            : contentHeaderBarClass,
        isPreviewExpanded && !sidebarCollapsed && contentHeaderPreviewExpandedStartClass,
        isPreviewExpanded && !canUserRestoreSidebar && 'gap-0',
      )}
      aria-label={t('sidebar.chat')}
    >
      {chatHeaderZone}
      {previewHeaderZone}
    </header>
  );
}
