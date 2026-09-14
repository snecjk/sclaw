/**
 * useAppDevSplitResize — 建站工作台 会话 | 预览 左右拖拽。
 *
 * 会话在左：向右拖会话变宽。空闲态写百分比；拖动中临时写 px；松手恢复百分比。
 * Pointer Capture + window 监听；全屏 shield 避免 Electron webview 吞掉 pointer。
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  APP_DEV_CHAT_SPLIT_CSS_VAR,
  APP_DEV_SPLIT_RESIZE_SHIELD_ID,
  applyAppDevChatColWidth,
  clampAppDevChatSplitFromPx,
  clampAppDevChatSplitPercent,
  clampAppDevChatWidthPx,
} from '@/lib/app-dev-split';

function ensureResizeShield(): HTMLDivElement {
  let shield = document.getElementById(APP_DEV_SPLIT_RESIZE_SHIELD_ID) as HTMLDivElement | null;
  if (!shield) {
    shield = document.createElement('div');
    shield.id = APP_DEV_SPLIT_RESIZE_SHIELD_ID;
    shield.setAttribute('aria-hidden', 'true');
    shield.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:400',
      'cursor:col-resize',
      'user-select:none',
      'touch-action:none',
      'background:transparent',
    ].join(';');
    document.body.appendChild(shield);
  }
  return shield;
}

function removeResizeShield(): void {
  document.getElementById(APP_DEV_SPLIT_RESIZE_SHIELD_ID)?.remove();
}

export function useAppDevSplitResize(
  chatSplitPercent: number,
  setChatSplitPercent: (percent: number) => void,
  enabled: boolean,
) {
  const splitRowRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const percentRef = useRef(chatSplitPercent);
  const dragCleanupRef = useRef<((mode: 'commit' | 'cancel' | 'unmount') => void) | null>(null);
  const setChatSplitPercentRef = useRef(setChatSplitPercent);
  const unmountedRef = useRef(false);
  const enabledRef = useRef(enabled);

  useLayoutEffect(() => {
    setChatSplitPercentRef.current = setChatSplitPercent;
    enabledRef.current = enabled;
  }, [enabled, setChatSplitPercent]);

  useLayoutEffect(() => {
    percentRef.current = chatSplitPercent;
    if (!enabled) {
      splitRowRef.current?.style.removeProperty(APP_DEV_CHAT_SPLIT_CSS_VAR);
      return;
    }
    if (!isResizingRef.current) {
      applyAppDevChatColWidth(splitRowRef.current, `${chatSplitPercent}%`);
    }
  }, [chatSplitPercent, enabled]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      dragCleanupRef.current?.('unmount');
      dragCleanupRef.current = null;
    };
  }, []);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabledRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    dragCleanupRef.current?.('cancel');

    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startWidth = chatPanelRef.current?.offsetWidth ?? 0;
    const containerWidth = splitRowRef.current?.clientWidth || window.innerWidth;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    let rafId: number | null = null;
    let pendingWidth =
      startWidth
      || (containerWidth * percentRef.current) / 100;
    let finished = false;

    isResizingRef.current = true;
    setIsResizing(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    ensureResizeShield();

    try {
      handle.setPointerCapture?.(pointerId);
    } catch {
      // ignore capture failures (jsdom / unsupported)
    }

    const applyWidth = () => {
      rafId = null;
      applyAppDevChatColWidth(splitRowRef.current, `${pendingWidth}px`);
    };

    const endDrag = (mode: 'commit' | 'cancel' | 'unmount') => {
      if (finished) return;
      finished = true;

      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleBlur);
      handle.removeEventListener('lostpointercapture', handleLostCapture);

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      try {
        if (handle.hasPointerCapture?.(pointerId)) {
          handle.releasePointerCapture?.(pointerId);
        }
      } catch {
        // ignore
      }

      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      removeResizeShield();

      isResizingRef.current = false;
      dragCleanupRef.current = null;

      if (mode === 'unmount') {
        applyAppDevChatColWidth(splitRowRef.current, `${percentRef.current}%`);
        return;
      }

      if (mode === 'commit') {
        const containerW = splitRowRef.current?.clientWidth || containerWidth;
        const newPercent = clampAppDevChatSplitFromPx(containerW, pendingWidth);
        applyAppDevChatColWidth(splitRowRef.current, `${newPercent}%`);
        percentRef.current = newPercent;
        setChatSplitPercentRef.current(newPercent);
      } else {
        applyAppDevChatColWidth(splitRowRef.current, `${percentRef.current}%`);
      }

      if (!unmountedRef.current) {
        setIsResizing(false);
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const delta = moveEvent.clientX - startX;
      const width = splitRowRef.current?.clientWidth || containerWidth;
      pendingWidth = clampAppDevChatWidthPx(width, startWidth + delta);
      if (rafId === null) {
        rafId = requestAnimationFrame(applyWidth);
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      endDrag('commit');
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      endDrag('cancel');
    };

    const handleBlur = () => {
      endDrag('cancel');
    };

    const handleLostCapture = (lostEvent: PointerEvent) => {
      if (lostEvent.pointerId !== pointerId) return;
      endDrag('cancel');
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleBlur);
    handle.addEventListener('lostpointercapture', handleLostCapture);

    dragCleanupRef.current = endDrag;
  };

  const adjustChatPercent = (deltaPercent: number) => {
    if (!enabledRef.current) return;
    const next = clampAppDevChatSplitPercent(percentRef.current + deltaPercent);
    percentRef.current = next;
    applyAppDevChatColWidth(splitRowRef.current, `${next}%`);
    setChatSplitPercentRef.current(next);
  };

  return {
    splitRowRef,
    chatPanelRef,
    startResize,
    adjustChatPercent,
    isResizing,
  };
}
