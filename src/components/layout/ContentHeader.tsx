/**
 * ContentHeader — 省区主内容白卡片顶部 52px 全局标题栏。
 *
 * 双栏：左=侧栏展开钮+会话 chip，右=actions。
 * 三栏：grid 与 split row 同列宽——左=侧栏+会话，中=resizer 占位，右=预览 tab+actions。
 * macOS 侧栏收起时 pad-start 走 CSS 变量（与 split row 共用），避让红绿灯。
 */
import { isValidElement, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  contentHeaderBarClass,
  contentHeaderSplitBarClass,
  contentHeaderSplitChatZoneClass,
  contentHeaderSplitPreviewZoneClass,
  contentHeaderTitleClass,
  contentHeaderTitleGroupClass,
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
  const previewPanelPercent = useSettingsStore((s) => s.previewSplitPercent ?? 50);
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
    const splitStyle = {
      '--sto-split-preview-col': `${previewPanelPercent}%`,
    } as CSSProperties;

    return (
      <header
        className={contentHeaderSplitBarClass}
        style={splitStyle}
        aria-label={t('sidebar.chat')}
      >
        <div className={contentHeaderSplitChatZoneClass}>{titleZone}</div>
        <div className="w-1 shrink-0" aria-hidden />
        <div className={contentHeaderSplitPreviewZoneClass}>
          {previewTabs ? (
            <div className="flex min-w-0 flex-1 items-center overflow-hidden">{previewTabs}</div>
          ) : (
            <div className="min-w-0 flex-1" aria-hidden />
          )}
          {actionsZone}
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
