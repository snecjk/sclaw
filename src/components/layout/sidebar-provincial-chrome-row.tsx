/**
 * SidebarProvincialChromeRow — 侧栏列顶行（交通灯留白 + DEV + 折叠钮）。
 *
 * MasterGo：无全局 52px 顶栏；折叠钮距窗口顶 12px，与白卡片顶边 gutter 对齐。
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ChromeProvincialLeading } from '@/components/layout/chrome-env-badge';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';
import { useSettingsStore } from '@/stores/settings';

export function SidebarProvincialChromeRow() {
  const { t } = useTranslation('common');
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const isMac = window.electron?.platform === 'darwin';

  return (
    <div
      className={cn(
        'drag-region flex min-h-[var(--sto-chrome-h)] shrink-0 items-start justify-between gap-2 px-3 pt-[var(--sto-chrome-toggle-inset-top)]',
        isMac && 'pl-20',
      )}
    >
      <ChromeProvincialLeading />
      <div className="no-drag shrink-0">
        <SidebarHeaderToggle
          isCollapsed={false}
          onToggle={() => setSidebarCollapsed(true)}
          collapseLabel={t('sidebar.toggleSidebarCollapse')}
          expandLabel={t('sidebar.toggleSidebarExpand')}
        />
      </div>
    </div>
  );
}
