/**
 * ContentHeader — 省区主内容白卡片顶部 52px 全局标题栏。
 *
 * 双栏：左=侧栏展开钮+会话 chip，右=actions。
 * 三栏：grid 与 split row 同列宽——左=侧栏+会话，中=resizer 占位，右=预览 tab+actions。
 * macOS 侧栏收起时 pad-start 走 CSS 变量（与 split row 共用），避让红绿灯。
 */
import { isValidElement } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  contentHeaderBarClass,
  contentHeaderSplitChatZoneClass,
  contentHeaderSplitPreviewZoneClass,
  contentHeaderTitleClass,
  contentHeaderTitleGroupClass,
  stoSplitGridContentsClass,
  stoSplitGridHeaderChatClass,
  stoSplitGridHeaderPreviewClass,
  stoSplitGridHeaderResizerClass,
} from '@/lib/surfaces';
import { ContentHeaderSessionChip } from '@/components/layout/content-header-session-chip';
import { useContentHeaderDisplay } from '@/components/layout/content-header-context';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';
import { useSettingsStore } from '@/stores/settings';

export function ContentHeader() {
  const { t } = useTranslation('common');
  const { title, previewTabs, actions, isSplitLayout, onCloseSession } = useContentHeaderDisplay();
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const platform = window.electron?.platform;
  const isWin = platform === 'win32';

  const titleText = typeof title === 'string' ? title : null;
  const showTitle = title != null && title !== '';

  const titleZone = (
    <div
      className={cn(
        contentHeaderTitleGroupClass,
        isSplitLayout && 'max-w-none min-w-0 shrink',
        !showTitle && !sidebarCollapsed && 'min-w-0',
      )}
    >
      {sidebarCollapsed ? (
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

  const actionsZone = actions ? (
    <div
      className={cn(
        'no-drag flex shrink-0 items-center gap-1',
        isWin && 'pr-28',
      )}
    >
      {actions}
    </div>
  ) : null;

  if (isSplitLayout) {
    return (
      <header className={stoSplitGridContentsClass} aria-label={t('sidebar.chat')}>
        <div className={stoSplitGridHeaderChatClass}>
          <div className={contentHeaderSplitChatZoneClass}>{titleZone}</div>
        </div>
        <div className={stoSplitGridHeaderResizerClass} aria-hidden />
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
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className={contentHeaderBarClass} aria-label={t('sidebar.chat')}>
      {titleZone}
      <div className="min-w-0 flex-1" aria-hidden />
      {actionsZone}
    </header>
  );
}
