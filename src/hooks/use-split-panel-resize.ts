/**
 * useSplitPanelResize — 三栏预览区拖拽分割（Chat / 首页 / 任务子项共用）
 *
 * 空闲态只写百分比（CSS 随窗口自适应）；拖动中临时写 px；松手恢复百分比。
 * Pointer Capture + window 监听；不创建全屏 overlay。
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  resolveSplitGridContainerWidth,
  STO_PREVIEW_SPLIT_MAX,
  STO_PREVIEW_SPLIT_MIN,
} from '@/lib/surfaces';

function resolveSplitMainEl(anchorEl: HTMLElement | null): HTMLElement | null {
  return anchorEl?.closest('main') ?? null;
}

/** 仅 main 持有 --sto-split-preview-col（统一 grid 唯一列宽来源） */
function applySplitColWidth(anchorEl: HTMLElement | null, value: string, overlay: boolean): void {
  const main = resolveSplitMainEl(anchorEl);
  if (main === null) return;
  main.style.setProperty(overlay ? '--sto-preview-overlay-width' : '--sto-split-preview-col', value);
}

export function useSplitPanelResize(
  previewPanelPercent: number,
  setPreviewSplitPercent: (percent: number) => void,
  { overlay = false }: { overlay?: boolean } = {},
) {
  const minPercent = overlay ? 40 : STO_PREVIEW_SPLIT_MIN;
  const unit = overlay ? 'vw' : '%';
  const splitRowRef = useRef<HTMLDivElement>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const percentRef = useRef(previewPanelPercent);
  const dragCleanupRef = useRef<((mode: 'commit' | 'cancel' | 'unmount') => void) | null>(null);
  const setPreviewSplitPercentRef = useRef(setPreviewSplitPercent);
  const unmountedRef = useRef(false);

  useLayoutEffect(() => {
    // Cancel against the old mode before installing the new persistence callback.
    dragCleanupRef.current?.('cancel');
  }, [overlay]);

  useLayoutEffect(() => {
    setPreviewSplitPercentRef.current = setPreviewSplitPercent;
  }, [setPreviewSplitPercent]);

  useLayoutEffect(() => {
    percentRef.current = previewPanelPercent;

    if (!isResizingRef.current) {
      applySplitColWidth(splitRowRef.current, `${previewPanelPercent}${unit}`, overlay);
    }
  }, [previewPanelPercent, overlay, unit]);

  useEffect(() => {
    unmountedRef.current = false;
    const cancelResize = () => dragCleanupRef.current?.('cancel');
    window.addEventListener('resize', cancelResize);
    return () => {
      window.removeEventListener('resize', cancelResize);
      unmountedRef.current = true;
      dragCleanupRef.current?.('unmount');
      dragCleanupRef.current = null;
    };
  }, []);

  const syncPercentToDom = (percent: number) => {
    applySplitColWidth(splitRowRef.current, `${percent}${unit}`, overlay);
  };

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    dragCleanupRef.current?.('cancel');

    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startWidth = previewPanelRef.current?.offsetWidth ?? 0;
    const containerWidth =
      (overlay ? window.innerWidth : resolveSplitGridContainerWidth(splitRowRef.current)) || window.innerWidth;
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

    try {
      handle.setPointerCapture?.(pointerId);
    } catch {
      // ignore capture failures (jsdom / unsupported)
    }

    const applyWidth = () => {
      rafId = null;
      applySplitColWidth(splitRowRef.current, `${pendingWidth}px`, overlay);
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

      if (mode === 'unmount') {
        applySplitColWidth(splitRowRef.current, `${percentRef.current}${unit}`, overlay);
        return;
      }

      if (mode === 'commit') {
        const containerW =
          (overlay ? window.innerWidth : resolveSplitGridContainerWidth(splitRowRef.current)) || containerWidth;
        const newPercent = Math.max(minPercent, Math.min(STO_PREVIEW_SPLIT_MAX, pendingWidth / containerW * 100));
        applySplitColWidth(splitRowRef.current, `${newPercent}${unit}`, overlay);
        percentRef.current = newPercent;
        setPreviewSplitPercentRef.current(newPercent);
      } else {
        applySplitColWidth(splitRowRef.current, `${percentRef.current}${unit}`, overlay);
      }

      if (!unmountedRef.current) {
        setIsResizing(false);
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const delta = startX - moveEvent.clientX;
      const width = (overlay ? window.innerWidth : resolveSplitGridContainerWidth(splitRowRef.current)) || containerWidth;
      pendingWidth = Math.max(
        width * (minPercent / 100),
        Math.min(width * (STO_PREVIEW_SPLIT_MAX / 100), startWidth + delta),
      );
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

  const adjustPreviewPercent = (deltaPercent: number) => {
    const next = Math.max(
      minPercent,
      Math.min(STO_PREVIEW_SPLIT_MAX, percentRef.current + deltaPercent),
    );
    percentRef.current = next;
    syncPercentToDom(next);
    setPreviewSplitPercentRef.current(next);
  };

  return {
    splitRowRef,
    previewPanelRef,
    startResize,
    adjustPreviewPercent,
    isResizing,
  };
}
