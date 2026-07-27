/**
 * Chrome-like tab strip — favicon comes from the page (page-favicon-updated), like Chrome.
 */
import { useEffect, useState } from 'react';
import { Code2, Globe, Home, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  APP_PLAZA_HOME_TAB_ID,
  type AppPlazaBrowserTab,
  useAppPlazaShellStore,
} from '@/stores/app-plaza-shell';
import { useSettingsStore } from '@/stores/settings';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';

/** Chrome tab icon: page favicon when available, otherwise generic globe. */
function TabFavicon({ tab }: { tab: AppPlazaBrowserTab }) {
  const [failed, setFailed] = useState(false);
  const pageFavicon = tab.pageFaviconUrl?.trim();

  useEffect(() => {
    setFailed(false);
  }, [pageFavicon, tab.id]);

  if (tab.status === 'blank') {
    return <Globe className="app-plaza-tab__icon-svg" aria-hidden />;
  }

  if (pageFavicon && !failed) {
    return (
      <img
        key={pageFavicon}
        src={pageFavicon}
        alt=""
        className="app-plaza-tab__favicon"
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }

  // Loading / no favicon yet — same placeholder Chrome uses before page reports one.
  return <Globe className="app-plaza-tab__icon-svg" aria-hidden />;
}

export function AppPlazaTabStrip() {
  const { t } = useTranslation('common');
  const activeTabId = useAppPlazaShellStore((s) => s.activeTabId);
  const browserTabs = useAppPlazaShellStore((s) => s.browserTabs);
  const devAppTabs = useAppPlazaShellStore((s) => s.devAppTabs);
  const selectTab = useAppPlazaShellStore((s) => s.selectTab);
  const addBlankTab = useAppPlazaShellStore((s) => s.addBlankTab);
  const closeBrowserTab = useAppPlazaShellStore((s) => s.closeBrowserTab);
  const closeDevAppTab = useAppPlazaShellStore((s) => s.closeDevAppTab);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);

  return (
    <div
      className="app-plaza-tabstrip"
      role="tablist"
      aria-label={t('moreApps.browserTabs.aria', { defaultValue: '应用页签' })}
    >
      {sidebarCollapsed ? (
        <SidebarHeaderToggle
          isCollapsed
          onToggle={() => setSidebarCollapsed(false)}
          collapseLabel={t('sidebar.toggleSidebarCollapse')}
          expandLabel={t('sidebar.toggleSidebarExpand')}
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

      {devAppTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTabId === tab.id}
          className={cn(
            'app-plaza-tab',
            activeTabId === tab.id && 'app-plaza-tab--active',
          )}
          onClick={() => selectTab(tab.id)}
          title={tab.title}
        >
          <Code2 className="app-plaza-tab__icon-svg" aria-hidden />
          <span className="app-plaza-tab__label">{tab.title}</span>
          <span
            role="button"
            tabIndex={-1}
            className="app-plaza-tab__close"
            aria-label={t('moreApps.browserTabs.close', { defaultValue: '关闭页签' })}
            onClick={(event) => {
              event.stopPropagation();
              closeDevAppTab(tab.id);
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
    </div>
  );
}
