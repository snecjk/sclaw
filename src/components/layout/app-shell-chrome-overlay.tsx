/** Shell fallback for provincial pages without ContentHeader or App Plaza TabStrip. */
import { WindowsWindowControls } from '@/components/layout/windows-window-controls';
import { useWindowsChromeOwner } from '@/hooks/use-windows-chrome-owner';

export const SHELL_FALLBACK_DRAG_STRIP_HEIGHT_PX = 6;

export function AppShellChromeOverlay() {
  const platform = window.electron?.platform;
  const chromeOwner = useWindowsChromeOwner();

  if (chromeOwner !== 'shell-fallback') return null;

  return (
    <>
      <div
        data-slot="shell-fallback-drag-strip"
        aria-hidden="true"
        className="drag-region pointer-events-auto absolute inset-x-0 top-0 z-40"
        style={{ height: `${SHELL_FALLBACK_DRAG_STRIP_HEIGHT_PX}px` }}
      />
      {platform === 'win32' ? (
        <div className="no-drag pointer-events-auto absolute right-0 top-0 z-50 flex min-h-[var(--sto-chrome-h)] items-start pr-1 pt-[var(--sto-chrome-toggle-inset-top)]">
          <WindowsWindowControls />
        </div>
      ) : null}
    </>
  );
}
