/**
 * AppShellChromeOverlay — 省区壳层浮动控件（无整行顶栏）。
 *
 * 侧栏收起：交通灯旁展开钮；Windows：右上角窗口控制。macOS 展开态控件在 SidebarProvincialChromeRow。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, Copy } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';
import { useSettingsStore } from '@/stores/settings';

const WIN_BTN_CLASS =
  'flex h-8 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-black/[0.04]';

export function AppShellChromeOverlay() {
  const platform = window.electron?.platform;
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);

  if (platform === 'linux') {
    return null;
  }

  return (
    <>
      {sidebarCollapsed ? <CollapsedSidebarExpandOverlay isMac={platform === 'darwin'} /> : null}
      {platform === 'win32' ? <WindowsControlsOverlay /> : null}
    </>
  );
}

function CollapsedSidebarExpandOverlay({ isMac }: { isMac: boolean }) {
  const { t } = useTranslation('common');
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);

  return (
    <div className="pointer-events-none absolute left-0 top-0 z-40 h-[var(--sto-chrome-h)] w-full">
      {/* 交通灯留白区仍可拖拽窗口；展开钮单独 no-drag 避免 Electron drag-region 吞点击 */}
      <div
        className={cn(
          'drag-region pointer-events-auto absolute left-0 top-0 h-full',
          isMac ? 'w-20' : 'w-12',
        )}
        aria-hidden
      />
      <div
        className={cn(
          'no-drag pointer-events-auto absolute top-0 flex px-3 pt-[var(--sto-chrome-toggle-inset-top)]',
          isMac ? 'left-20' : 'left-3',
        )}
      >
        <SidebarHeaderToggle
          isCollapsed
          onToggle={() => setSidebarCollapsed(false)}
          collapseLabel={t('sidebar.toggleSidebarCollapse')}
          expandLabel={t('sidebar.toggleSidebarExpand')}
        />
      </div>
    </div>
  );
}

function WindowsControlsOverlay() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  return (
    <div className="no-drag absolute right-0 top-0 z-40 flex min-h-[var(--sto-chrome-h)] items-start pr-1 pt-[var(--sto-chrome-toggle-inset-top)]">
      <button
        type="button"
        onClick={() => invokeIpc('window:minimize')}
        className={WIN_BTN_CLASS}
        title="Minimize"
      >
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => {
          invokeIpc('window:maximize').then(() => {
            invokeIpc('window:isMaximized').then((val) => {
              setMaximized(val as boolean);
            });
          });
        }}
        className={WIN_BTN_CLASS}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Square className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onClick={() => invokeIpc('window:close')}
        className={cn(WIN_BTN_CLASS, 'hover:bg-red-500 hover:text-white')}
        title="Close"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
