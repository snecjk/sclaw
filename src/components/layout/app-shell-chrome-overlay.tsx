/** Shell fallback for provincial pages without ContentHeader or App Plaza TabStrip. */
import { WindowsWindowControls } from '@/components/layout/windows-window-controls';
import { useWindowsChromeOwner } from '@/hooks/use-windows-chrome-owner';

export function AppShellChromeOverlay() {
  const platform = window.electron?.platform;
  const chromeOwner = useWindowsChromeOwner();

  if (platform !== 'win32' || chromeOwner !== 'shell-fallback') return null;

  return (
    <div className="no-drag pointer-events-auto absolute right-0 top-0 z-50 flex min-h-[var(--sto-chrome-h)] items-start pr-1 pt-[var(--sto-chrome-toggle-inset-top)]">
      <WindowsWindowControls />
    </div>
  );
}
