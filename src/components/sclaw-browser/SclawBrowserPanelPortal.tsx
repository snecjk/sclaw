/**
 * Content panel portaled to document.body — browser + optional AI chat split.
 */
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { useSclawBrowserHostBounds } from './use-sclaw-browser-host-bounds';
import { SclawBrowserFrame } from './SclawBrowserFrame';
import { SclawBrowserEmbedChat } from './SclawBrowserEmbedChat';
import { useSclawBrowserSplitResize } from './use-sclaw-browser-split-resize';
import './sclaw-browser-overlay.css';

import { SCLAW_BROWSER_DRAWER_ANIM_MS, SCLAW_BROWSER_TOOLBAR_H } from './constants';

export function SclawBrowserPanelPortal() {
  const session = useSclawBrowserOverlayStore((s) => s.session);
  const chatPanelOpen = useSclawBrowserOverlayStore((s) => s.chatPanelOpen);
  const chatSessionKey = useSclawBrowserOverlayStore((s) => s.chatSessionKey);
  const chatSplitPercent = useSclawBrowserOverlayStore((s) => s.chatSplitPercent);
  const setChatSplitPercent = useSclawBrowserOverlayStore((s) => s.setChatSplitPercent);
  const embedRuntimeId = useSclawBrowserOverlayStore((s) => s.embedRuntimeId);
  const bounds = useSclawBrowserHostBounds(session !== null);
  const [frameReady, setFrameReady] = useState(false);
  const { splitRef, startResize, isResizing } = useSclawBrowserSplitResize(
    chatSplitPercent,
    setChatSplitPercent,
    chatPanelOpen,
    embedRuntimeId,
  );

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
      <div
        ref={splitRef}
        className={
          chatPanelOpen
            ? `sclaw-browser-split${isResizing ? ' sclaw-browser-split--resizing' : ''}`
            : 'sclaw-browser-split sclaw-browser-split--browser-only'
        }
      >
        <div className="sclaw-browser-split__browser">
          {frameReady ? (
            <SclawBrowserFrame url={session.url} title={session.title} />
          ) : null}
        </div>
        {chatPanelOpen && chatSessionKey ? (
          <>
            <button
              type="button"
              className="sclaw-browser-split__resizer"
              aria-label="Resize chat panel"
              onPointerDown={startResize}
            />
            <div className="sclaw-browser-split__chat">
              <SclawBrowserEmbedChat sessionKey={chatSessionKey} appTitle={session.title} />
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
