/**
 * TitleBar Component — full layout 专用 52px 顶栏。
 *
 * macOS: 交通灯区留白 + 品牌 Logo；Windows: 品牌 + 窗口控制钮；Linux: 不渲染。
 * 省区 layout 使用内嵌壳层控件，不在此渲染。
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ChromeEnvBadge } from '@/components/layout/chrome-env-badge';
import logoSvg from '@/assets/logo.svg';

/** TitleBar 壳层 — 固定 52px，与 --sto-header-h 对齐 */
const TITLEBAR_SHELL_CLASS =
  'drag-region flex h-[var(--sto-header-h)] w-full shrink-0 items-center border-b glass-chrome';

function TitleBarBrandLogo() {
  return (
    <div className="flex items-center gap-2 px-3">
      <img src={logoSvg} alt="StoClaw" className="h-5 w-auto shrink-0" />
      <span className="whitespace-nowrap text-sm font-semibold text-foreground/90">S Claw</span>
      <ChromeEnvBadge />
    </div>
  );
}

export function TitleBar() {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    return (
      <div className={cn(TITLEBAR_SHELL_CLASS, 'pl-20 pr-3')}>
        <div className="no-drag shrink-0">
          <TitleBarBrandLogo />
        </div>
      </div>
    );
  }

  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  return (
    <div className={cn(TITLEBAR_SHELL_CLASS, 'justify-between')}>
      <div className="no-drag shrink-0">
        <TitleBarBrandLogo />
      </div>

      <div className="no-drag flex h-full">
        <button
          type="button"
          onClick={() => invokeIpc('window:minimize')}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-white/10"
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
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-white/10"
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
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
          title="Close"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
