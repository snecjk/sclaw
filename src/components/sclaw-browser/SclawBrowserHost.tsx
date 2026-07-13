/**
 * SClawBrowserHost — drawer mount point inside MainLayout main card.
 */
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { SclawBrowserDrawer } from './SclawBrowserDrawer';
import { SCLAW_BROWSER_PORTAL_ID } from './constants';
import './sclaw-browser-overlay.css';

export function SclawBrowserHost() {
  const active = useSclawBrowserOverlayStore((s) => s.session !== null);

  useEffect(() => {
    if (active) {
      document.documentElement.dataset.sclawBrowserOpen = 'true';
      return () => {
        delete document.documentElement.dataset.sclawBrowserOpen;
      };
    }
    delete document.documentElement.dataset.sclawBrowserOpen;
  }, [active]);

  return (
    <div
      id={SCLAW_BROWSER_PORTAL_ID}
      className={cn('sclaw-browser-host', active && 'sclaw-browser-host--active')}
      aria-hidden={!active}
    >
      <SclawBrowserDrawer />
    </div>
  );
}
