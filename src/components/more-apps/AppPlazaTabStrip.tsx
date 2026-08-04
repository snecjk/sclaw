/**
 * Chrome-like tab strip — favicon comes from the page (page-favicon-updated), like Chrome.
 */
import { useState } from 'react';
import { Globe, Home, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  APP_PLAZA_HOME_TAB_ID,
  type AppPlazaBrowserTab,
  useAppPlazaShellStore,
} from '@/stores/app-plaza-shell';
import { useAppShellLayout } from '@/components/layout/app-shell-layout-context';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';
import { WindowsWindowControls } from '@/components/layout/windows-window-controls';
import { useWindowsChromeOwner } from '@/hooks/use-windows-chrome-owner';

/** Chrome tab icon: page favicon when available, otherwise generic globe. */
function TabFavicon({ tab }: { tab: AppPlazaBrowserTab }) {
  const pageFavicon = tab.pageFaviconUrl?.trim();

  if (tab.status === 'blank') {
    return <Globe className="app-plaza-tab__icon-svg" aria-hidden />;
  }

  if (pageFavicon) {
    // Remount on URL change so failed state resets without an effect.
    return <TabFaviconImage key={`${tab.id}:${pageFavicon}`} src={pageFavicon} />;
  }

  // Loading / no favicon yet — same placeholder Chrome uses before page reports one.
  return <Globe className="app-plaza-tab__icon-svg" aria-hidden />;
}

function TabFaviconImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <Globe className="app-plaza-tab__icon-svg" aria-hidden />;
  }
  return (
    <img
      src={src}
      alt=""
      className="app-plaza-tab__favicon"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function AppPlazaTabStrip() {
  const { t } = useTranslation('common');
  const activeTabId = useAppPlazaShellStore((s) => s.activeTabId);
  const browserTabs = useAppPlazaShellStore((s) => s.browserTabs);
  const selectTab = useAppPlazaShellStore((s) => s.selectTab);
  const addBlankTab = useAppPlazaShellStore((s) => s.addBlankTab);
  const closeBrowserTab = useAppPlazaShellStore((s) => s.closeBrowserTab);
  const { snapshot, setUserCollapsed } = useAppShellLayout();
  const canUserRestoreSidebar = snapshot.canUserRestoreSidebar;
  const windowsChromeOwner = useWindowsChromeOwner();

  return (
    <div
      className="app-plaza-tabstrip drag-region"
      role="tablist"
      aria-label={t('moreApps.browserTabs.aria', { defaultValue: '应用页签' })}
    >
      {canUserRestoreSidebar ? (
        <SidebarHeaderToggle
          isCollapsed
          onToggle={() => setUserCollapsed(false)}
          collapseLabel={t('sidebar.toggleSidebarCollapse')}
          expandLabel={t('sidebar.toggleSidebarExpand')}
          className="app-plaza-tabstrip__sidebar-toggle"
        />
      ) : null}

      <button
        type="button"
        role="tab"
        aria-selected={activeTabId === APP_PLAZA_HOME_TAB_ID}
        className={cn(
          'app-plaza-tab',
          activeTabId === APP_PLAZA_HOME_TAB_ID && 'app-plaza-tab--active',
        )}
        onClick={() => selectTab(APP_PLAZA_HOME_TAB_ID)}
      >
        <Home className="app-plaza-tab__icon-svg" aria-hidden />
        <span className="app-plaza-tab__label">
          {t('moreApps.browserTabs.home', { defaultValue: '首页' })}
        </span>
      </button>

      {browserTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTabId === tab.id}
          className={cn(
            'app-plaza-tab',
            activeTabId === tab.id && 'app-plaza-tab--active',
            tab.status === 'suspended' && 'app-plaza-tab--suspended',
          )}
          onClick={() => selectTab(tab.id)}
          title={tab.status === 'suspended'
            ? t('moreApps.browserTabs.suspendedHint', { defaultValue: '已暂停，点击重新加载' })
            : tab.title}
        >
          <TabFavicon tab={tab} />
          <span className="app-plaza-tab__label">{tab.title}</span>
          <span
            role="button"
            tabIndex={-1}
            className="app-plaza-tab__close"
            aria-label={t('moreApps.browserTabs.close', { defaultValue: '关闭页签' })}
            onClick={(event) => {
              event.stopPropagation();
              closeBrowserTab(tab.id);
            }}
          >
            <X className="h-3 w-3" aria-hidden />
          </span>
        </button>
      ))}

      <button
        type="button"
        className="app-plaza-tabstrip__add"
        onClick={() => addBlankTab()}
        aria-label={t('moreApps.browserTabs.add', { defaultValue: '新建空白页签' })}
        title={t('moreApps.browserTabs.add', { defaultValue: '新建空白页签' })}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>

      {/* Empty chrome — window drag (same pattern as ContentHeader). */}
      <div className="app-plaza-tabstrip__spacer" aria-hidden />
      {windowsChromeOwner === 'app-plaza' ? <WindowsWindowControls /> : null}
    </div>
  );
}
