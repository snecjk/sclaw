import { useLayoutEffect, useState } from 'react';
import { SCLAW_BROWSER_PORTAL_ID } from './constants';

/** Tracks the main-card host rect for portaled toolbar positioning. */
export function useSclawBrowserHostBounds(active: boolean): DOMRect | null {
  const [bounds, setBounds] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setBounds(null);
      return;
    }

    const host = document.getElementById(SCLAW_BROWSER_PORTAL_ID);
    if (!host) return;

    const update = () => {
      setBounds(host.getBoundingClientRect());
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [active]);

  return bounds;
}
