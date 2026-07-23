/**
 * ContentHeader — 省区主内容白卡片顶部 52px 全局标题栏。
 *
 * 双栏：左=侧栏展开钮+会话 chip，右=chatActions + actions。
 * 三栏：真实连续 52px Header（内嵌三列 grid 对齐 body）；左列=title+chatActions，右列=预览 tab+actions。
 * macOS 侧栏收起时 pad-start 走 CSS 变量（与 split row 共用），避让红绿灯。
 */
import { isValidElement } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  contentHeaderBarClass,
  contentHeaderSplitBarClass,
  contentHeaderSplitChatZoneClass,
  contentHeaderSplitPreviewZoneClass,
  contentHeaderTitleClass,
  contentHeaderTitleGroupClass,
  contentHeaderWinControlsReserveClass,
  stoSplitGridHeaderChatClass,
  stoSplitGridHeaderPreviewClass,
} from '@/lib/surfaces';
import { ContentHeaderSessionChip } from '@/components/layout/content-header-session-chip';
import { useContentHeaderDisplay } from '@/components/layout/content-header-context';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';
import { useSettingsStore } from '@/stores/settings';
import { useWorkflowUiStore } from '@/stores/workflow-ui';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';

export function ContentHeader() {
  const { t } = useTranslation('common');
  const { title, previewTabs, chatActions, actions, isSplitLayout, onCloseSession } =
    useContentHeaderDisplay();
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const workflowEditorActive = useWorkflowUiStore((s) => s.editorActive);
  const browserOverlayOpen = useSclawBrowserOverlayStore((s) => s.session !== null);

  // Drawer toolbar occupies the header band; drag-region steals clicks regardless of z-index.
  if (browserOverlayOpen) {
    return null;
  }

  const platform = window.electron?.platform;
  const isWin = platform === 'win32';

  const titleText = typeof title === 'string' ? title : null;
  const showTitle = title != null && title !== '';

  const titleZone = (
    <div
      className={cn(
        contentHeaderTitleGroupClass,
        // 三栏只允许继续收缩，不得取消 max-w-[min(34vw,280px)]（与两栏一致）
        isSplitLayout && 'min-w-0 shrink',
        isSplitLayout && 'overflow-hidden',
        workflowEditorActive && showTitle && 'max-w-none min-w-0 flex-1',
        !showTitle && !sidebarCollapsed && 'min-w-0',
      )}
    >
      {sidebarCollapsed && !workflowEditorActive ? (
        <SidebarHeaderToggle
          isCollapsed
          onToggle={() => setSidebarCollapsed(false)}
          collapseLabel={t('sidebar.toggleSidebarCollapse')}
          expandLabel={t('sidebar.toggleSidebarExpand')}
        />
      ) : null}
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
  );

  /** 会话区操作（搜索/刷新/思考）：三栏时贴对话列右缘，单栏时并入右上角 */
  const chatActionsZone = chatActions ? (
    <div className="no-drag flex shrink-0 items-center gap-1">
      {chatActions}
    </div>
  ) : null;

  const actionsZone = actions ? (
    <div className="no-drag flex shrink-0 items-center gap-1">
      {actions}
    </div>
  ) : null;

  /** Win 列表页等无 actions 时，drag-region 会挡住 AppShellChromeOverlay 的窗口三分控件 */
  const winControlsReserve = isWin ? (
    <div className={contentHeaderWinControlsReserveClass} aria-hidden />
  ) : null;

  if (isSplitLayout) {
    return (
      <header className={contentHeaderSplitBarClass} aria-label={t('sidebar.chat')}>
        <div className={stoSplitGridHeaderChatClass}>
          <div className={contentHeaderSplitChatZoneClass}>
            {titleZone}
            <div className="min-w-0 flex-1" aria-hidden />
            {chatActionsZone}
          </div>
        </div>
        <div className={stoSplitGridHeaderPreviewClass}>
          <div
            className={cn(
              contentHeaderSplitPreviewZoneClass,
              !previewTabs && actionsZone && 'justify-end',
            )}
          >
            {previewTabs ? (
              previewTabs
            ) : (
              <div className="min-w-0 flex-1" aria-hidden />
            )}
            {actionsZone}
            {winControlsReserve}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className={contentHeaderBarClass} aria-label={t('sidebar.chat')}>
      {titleZone}
      <div className="min-w-0 flex-1" aria-hidden />
      {chatActionsZone}
      {actionsZone}
      {winControlsReserve}
    </header>
  );
}
