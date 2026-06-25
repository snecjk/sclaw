/**
 * AppShellChromeOverlay — 省区壳层浮动控件（无整行顶栏）。
 *
 * 侧栏收起时展开钮已移入 ContentHeader；Windows 右上角窗口控制仍在此浮层。
 */
import { useEffect, useState } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const WIN_BTN_CLASS =
  'flex h-8 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-black/[0.04]';

export function AppShellChromeOverlay() {
  const platform = window.electron?.platform;

  if (platform === 'linux') {
    return null;
  }

  return platform === 'win32' ? <WindowsControlsOverlay /> : null;
}

function WindowsControlsOverlay() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  return (
    <div className="no-drag pointer-events-auto absolute right-0 top-0 z-50 flex min-h-[var(--sto-chrome-h)] items-start pr-1 pt-[var(--sto-chrome-toggle-inset-top)]">
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
