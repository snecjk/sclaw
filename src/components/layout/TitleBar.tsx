/**
 * TitleBar Component
 * macOS: Logo + text on left, drag region in middle, native traffic lights on right.
 * Windows: Logo + text on left, drag region in middle, custom minimize/maximize/close controls on right.
 * Linux: use native window chrome (no custom title bar).
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import logoSvg from '@/assets/logo.svg';

function BrandLogo() {
  return (
    <div className="flex items-center gap-2 px-3">
      <img src={logoSvg} alt="StoClaw" className="h-5 w-auto shrink-0" />
      <span className="text-sm font-semibold whitespace-nowrap text-foreground/90">
        StoClaw
      </span>
    </div>
  );
}

export function TitleBar() {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS: logo on left, drag region in middle, traffic lights are native
    return (
      <div className="drag-region flex h-10 shrink-0 items-center border-b glass pl-20">
        <div className="no-drag">
          <BrandLogo />
        </div>
      </div>
    );
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  const handleMinimize = () => {
    invokeIpc('window:minimize');
  };

  const handleMaximize = () => {
    invokeIpc('window:maximize').then(() => {
      invokeIpc('window:isMaximized').then((val) => {
        setMaximized(val as boolean);
      });
    });
  };

  const handleClose = () => {
    invokeIpc('window:close');
  };

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-between border-b glass">
      {/* Left: Brand Logo */}
      <div className="no-drag">
        <BrandLogo />
      </div>

      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-white/10 transition-colors"
          title="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-white/10 transition-colors"
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
