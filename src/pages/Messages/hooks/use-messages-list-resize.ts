import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  clampMessagesListWidth,
  MESSAGES_LIST_KEYBOARD_STEP,
} from '../lib/messages-list-resize-metrics';

export function useMessagesListResize(
  width: number,
  setWidth: (width: number) => void,
  panelRef: RefObject<HTMLElement | null>,
) {
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const widthRef = useRef(width);
  const setWidthRef = useRef(setWidth);
  const dragCleanupRef = useRef<((mode: 'commit' | 'cancel' | 'unmount') => void) | null>(null);
  const unmountedRef = useRef(false);

  useLayoutEffect(() => {
    widthRef.current = width;
    setWidthRef.current = setWidth;
  }, [width, setWidth]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      dragCleanupRef.current?.('unmount');
      dragCleanupRef.current = null;
    };
  }, []);

  const applyWidth = (nextWidth: number, updateRef = true) => {
    const clamped = clampMessagesListWidth(nextWidth);
    if (updateRef) {
      widthRef.current = clamped;
    }
    if (panelRef.current) {
      panelRef.current.style.width = `${clamped}px`;
    }
    return clamped;
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    dragCleanupRef.current?.('cancel');

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = panelRef.current?.offsetWidth ?? widthRef.current;
    const committedWidth = widthRef.current;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    let rafId: number | null = null;
    let pendingWidth = startWidth;
    let finished = false;

    isResizingRef.current = true;
    setIsResizing(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    try {
      handle.setPointerCapture?.(pointerId);
    } catch {
      // ignore
    }

    const flushWidth = () => {
      rafId = null;
      applyWidth(pendingWidth, false);
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
      isResizingRef.current = false;
      dragCleanupRef.current = null;

      if (mode === 'commit') {
        const committed = applyWidth(pendingWidth);
        setWidthRef.current(committed);
      } else {
        applyWidth(committedWidth);
      }

      if (!unmountedRef.current) {
        setIsResizing(false);
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      pendingWidth = startWidth + (moveEvent.clientX - startX);
      if (rafId === null) {
        rafId = requestAnimationFrame(flushWidth);
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

  const adjustWidth = (delta: number) => {
    const next = clampMessagesListWidth(widthRef.current + delta);
    widthRef.current = next;
    applyWidth(next);
    setWidthRef.current(next);
  };

  const handleKeyboardAdjust = (delta: number) => {
    adjustWidth(delta * MESSAGES_LIST_KEYBOARD_STEP);
  };

  return {
    startResize,
    adjustWidth: handleKeyboardAdjust,
    isResizing,
  };
}
