/**
 * Content panel portaled to document.body with explicit bounds (full-height iframe).
 */
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { useSclawBrowserHostBounds } from './use-sclaw-browser-host-bounds';
import './sclaw-browser-overlay.css';

import { SCLAW_BROWSER_DRAWER_ANIM_MS, SCLAW_BROWSER_TOOLBAR_H } from './constants';

export function SclawBrowserPanelPortal() {
  const session = useSclawBrowserOverlayStore((s) => s.session);
  const bounds = useSclawBrowserHostBounds(session !== null);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    if (!session) {
      setFrameReady(false);
      return;
    }
    const id = window.setTimeout(() => setFrameReady(true), SCLAW_BROWSER_DRAWER_ANIM_MS);
    return () => {
      window.clearTimeout(id);
      setFrameReady(false);
    };
  }, [session?.url]);

  if (!session || !bounds) return null;

  const panelTop = bounds.top + SCLAW_BROWSER_TOOLBAR_H;
  const panelHeight = Math.max(0, bounds.height - SCLAW_BROWSER_TOOLBAR_H);

  return createPortal(
    <div
      className="sclaw-browser-drawer-panel sclaw-browser-drawer-panel--portal"
      style={{
        top: panelTop,
        left: bounds.left,
        width: bounds.width,
        height: panelHeight,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={session.title}
    >
      {frameReady ? (
        <iframe
          src={session.url}
          title={session.title}
          className="sclaw-browser-drawer__frame"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
          referrerPolicy="no-referrer"
        />
      ) : null}
    </div>,
    document.body,
  );
}
