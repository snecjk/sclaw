/**
 * Horizontal split resize for browser drawer (browser | chat).
 * Uses pointer capture + full-screen shield + webview passthrough (Electron webview steals mouse).
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { setSclawBrowserPointerPassthrough } from '@/lib/sclaw-browser-host-api';

const MIN_CHAT_PERCENT = 28;
const MAX_CHAT_PERCENT = 55;
const RESIZE_SHIELD_ID = 'sclaw-browser-resize-shield';

function ensureResizeShield(): HTMLDivElement {
  let shield = document.getElementById(RESIZE_SHIELD_ID) as HTMLDivElement | null;
  if (!shield) {
    shield = document.createElement('div');
    shield.id = RESIZE_SHIELD_ID;
    shield.className = 'sclaw-browser-split__resize-shield';
    shield.setAttribute('aria-hidden', 'true');
    document.body.appendChild(shield);
  }
  return shield;
}

function removeResizeShield(): void {
  document.getElementById(RESIZE_SHIELD_ID)?.remove();
}

export function useSclawBrowserSplitResize(
  chatSplitPercent: number,
  setChatSplitPercent: (percent: number) => void,
  enabled: boolean,
  embedRuntimeId: string | null,
) {
  const splitRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const embedRuntimeIdRef = useRef(embedRuntimeId);
  embedRuntimeIdRef.current = embedRuntimeId;
  const percentRef = useRef(chatSplitPercent);

  percentRef.current = chatSplitPercent;

  useLayoutEffect(() => {
    const root = splitRef.current;
    if (!root || !enabled) {
      root?.style.removeProperty('--sclaw-browser-chat-col');
      return;
    }
    root.style.setProperty('--sclaw-browser-chat-col', `${chatSplitPercent}%`);
  }, [chatSplitPercent, enabled]);

  const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const root = splitRef.current;
    if (!root) return;

    const resizer = event.currentTarget;
    const pointerId = event.pointerId;
    let ended = false;

    const applyPercentFromClientX = (clientX: number) => {
      const rect = root.getBoundingClientRect();
      const width = rect.width;
      if (width <= 0) return;
      const chatPx = rect.right - clientX;
      const next = Math.min(MAX_CHAT_PERCENT, Math.max(MIN_CHAT_PERCENT, (chatPx / width) * 100));
      percentRef.current = next;
      root.style.setProperty('--sclaw-browser-chat-col', `${next}%`);
    };

    const endResize = () => {
      if (ended) return;
      ended = true;

      setIsResizing(false);
      setChatSplitPercent(percentRef.current);
      document.body.classList.remove('sclaw-browser-split-dragging');
      removeResizeShield();

      const runtimeId = embedRuntimeIdRef.current;
      if (runtimeId) {
        void setSclawBrowserPointerPassthrough(runtimeId, false);
      }

      resizer.removeEventListener('pointermove', onPointerMove);
      resizer.removeEventListener('pointerup', onPointerUp);
      resizer.removeEventListener('pointercancel', onPointerUp);
      resizer.removeEventListener('lostpointercapture', endResize);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('blur', endResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      try {
        if (resizer.hasPointerCapture(pointerId)) {
          resizer.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer may already be released when leaving the window.
      }
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      applyPercentFromClientX(moveEvent.clientX);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      upEvent.preventDefault();
      endResize();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        endResize();
      }
    };

    setIsResizing(true);
    document.body.classList.add('sclaw-browser-split-dragging');
    ensureResizeShield();

    const runtimeId = embedRuntimeIdRef.current;
    if (runtimeId) {
      void setSclawBrowserPointerPassthrough(runtimeId, true);
    }

    try {
      resizer.setPointerCapture(pointerId);
    } catch {
      // Continue with window-level listeners if capture fails.
    }

    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
    resizer.addEventListener('pointercancel', onPointerUp);
    resizer.addEventListener('lostpointercapture', endResize);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('blur', endResize);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }, [setChatSplitPercent]);

  return { splitRef, startResize, isResizing };
}
