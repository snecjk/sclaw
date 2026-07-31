/**
 * useSidebarResize — provincial AppShell Gap column drag (Pointer Capture + RAF).
 *
 * Hot path: pointermove → rAF → CSS `--sto-sidebar-effective-w` only.
 * Commit Zustand / host-api on pointerup (or collapse). Cancel restores preDrag.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { formatCssPx } from '@/lib/app-shell-metrics';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarPreferredWidth,
  resolveDragRenderedWidth,
  resolveKeyboardSidebarWidth,
  shouldCommitSidebarCollapse,
  type SidebarSnapTarget,
} from '@/lib/sidebar-resize-metrics';

export interface UseSidebarResizeOptions {
  /** AppShell root that owns `--sto-sidebar-effective-w` */
  shellRef: RefObject<HTMLElement | null>;
  preferredWidth: number;
  effectiveMax: number;
  /** Current committed display width when expanded */
  effectiveWidth: number;
  disabled?: boolean;
  onCommitWidth: (width: number) => void;
  onCommitCollapse: () => void;
}

function writeSidebarCssVar(shell: HTMLElement | null, widthPx: number): void {
  if (!shell) return;
  shell.style.setProperty('--sto-sidebar-effective-w', formatCssPx(widthPx));
}

export function useSidebarResize({
  shellRef,
  preferredWidth,
  effectiveMax,
  effectiveWidth,
  disabled = false,
  onCommitWidth,
  onCommitCollapse,
}: UseSidebarResizeOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const preferredRef = useRef(preferredWidth);
  const effectiveMaxRef = useRef(effectiveMax);
  const effectiveWidthRef = useRef(effectiveWidth);
  const onCommitWidthRef = useRef(onCommitWidth);
  const onCommitCollapseRef = useRef(onCommitCollapse);
  const dragCleanupRef = useRef<((mode: 'commit' | 'cancel' | 'unmount') => void) | null>(null);
  const unmountedRef = useRef(false);

  useLayoutEffect(() => {
    preferredRef.current = preferredWidth;
    effectiveMaxRef.current = effectiveMax;
    effectiveWidthRef.current = effectiveWidth;
    onCommitWidthRef.current = onCommitWidth;
    onCommitCollapseRef.current = onCommitCollapse;
  }, [preferredWidth, effectiveMax, effectiveWidth, onCommitWidth, onCommitCollapse]);

  useLayoutEffect(() => {
    if (isResizingRef.current) return;
    writeSidebarCssVar(shellRef.current, effectiveWidth);
  }, [effectiveWidth, shellRef]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      dragCleanupRef.current?.('unmount');
      dragCleanupRef.current = null;
    };
  }, []);

  const startResize = (e: ReactPointerEvent<HTMLElement>) => {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    dragCleanupRef.current?.('cancel');

    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const preDragWidth = clampSidebarPreferredWidth(
      effectiveWidthRef.current || preferredRef.current || SIDEBAR_DEFAULT_WIDTH,
    );
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    let rafId: number | null = null;
    let rawWidth = preDragWidth;
    let renderedWidth = preDragWidth;
    let snapTarget: SidebarSnapTarget = 'none';
    let finished = false;

    isResizingRef.current = true;
    setIsResizing(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    shellRef.current?.setAttribute('data-sidebar-resizing', 'true');

    try {
      handle.setPointerCapture?.(pointerId);
    } catch {
      // jsdom / unsupported
    }

    const applyRendered = () => {
      rafId = null;
      writeSidebarCssVar(shellRef.current, renderedWidth);
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
      shellRef.current?.removeAttribute('data-sidebar-resizing');

      isResizingRef.current = false;
      dragCleanupRef.current = null;

      if (mode === 'unmount') {
        writeSidebarCssVar(shellRef.current, preferredRef.current);
        return;
      }

      if (mode === 'commit') {
        if (shouldCommitSidebarCollapse(rawWidth)) {
          writeSidebarCssVar(shellRef.current, 0);
          onCommitCollapseRef.current();
        } else {
          const committed = clampSidebarPreferredWidth(
            Math.min(renderedWidth, effectiveMaxRef.current),
          );
          writeSidebarCssVar(shellRef.current, Math.min(committed, effectiveMaxRef.current));
          onCommitWidthRef.current(committed);
        }
      } else {
        writeSidebarCssVar(shellRef.current, preDragWidth);
      }

      if (!unmountedRef.current) {
        setIsResizing(false);
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      rawWidth = preDragWidth + (moveEvent.clientX - startX);
      const next = resolveDragRenderedWidth({
        rawWidth,
        snapTarget,
        effectiveMax: effectiveMaxRef.current,
      });
      snapTarget = next.nextSnapTarget;
      renderedWidth = next.renderedWidth;
      if (rafId === null) {
        rafId = requestAnimationFrame(applyRendered);
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

  const adjustWidthByKeyboard = (key: string, shiftKey: boolean) => {
    if (disabled) return;
    const next = resolveKeyboardSidebarWidth({
      current: preferredRef.current,
      effectiveMax: effectiveMaxRef.current,
      key,
      shiftKey,
    });
    if (next == null) return;
    writeSidebarCssVar(shellRef.current, Math.min(next, effectiveMaxRef.current));
    onCommitWidthRef.current(next);
  };

  return {
    isResizing,
    startResize,
    adjustWidthByKeyboard,
    minWidth: SIDEBAR_MIN_WIDTH,
  };
}
