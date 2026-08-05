/**
 * Shared Windows controls for provincial draggable Chrome Surfaces.
 *
 * The active Chrome owner renders this component inside its own drag-region so
 * Electron can subtract the no-drag controls from the native drag hit map.
 * Full-layout TitleBar keeps its existing, independently sized controls.
 */
import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const WINDOWS_CONTROL_BUTTON_CLASS = cn(
  'flex h-8 w-10 items-center justify-center text-muted-foreground',
  'transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

export function WindowsWindowControls({ className }: { className?: string }) {
  const isWindows = window.electron?.platform === 'win32';
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWindows) return;
    void invokeIpc<boolean>('window:isMaximized').then(setMaximized);
  }, [isWindows]);

  if (!isWindows) return null;

  const toggleMaximized = async () => {
    await invokeIpc('window:maximize');
    setMaximized(await invokeIpc<boolean>('window:isMaximized'));
  };

  return (
    <div
      data-slot="windows-window-controls"
      className={cn('no-drag flex shrink-0 items-center', className)}
    >
      <button
        type="button"
        onClick={() => void invokeIpc('window:minimize')}
        className={WINDOWS_CONTROL_BUTTON_CLASS}
        title="Minimize"
        aria-label="Minimize"
      >
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => void toggleMaximized()}
        className={WINDOWS_CONTROL_BUTTON_CLASS}
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Square className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onClick={() => void invokeIpc('window:close')}
        className={cn(
          WINDOWS_CONTROL_BUTTON_CLASS,
          'hover:bg-destructive hover:text-destructive-foreground',
        )}
        title="Close"
        aria-label="Close"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
