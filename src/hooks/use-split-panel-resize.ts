/**
 * useSplitPanelResize — 三栏预览区拖拽分割（Chat / 首页 / 任务子项共用）
 *
 * 三栏统一 grid：--sto-split-preview-col 只写在 main；ResizeObserver 观测 main 内容宽。
 * 不用 React style，避免松手后旧 % 覆盖拖拽 px 导致回弹。
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  clampPreviewPanelPercent,
  resolveSplitGridContainerWidth,
  STO_PREVIEW_SPLIT_MAX,
  STO_PREVIEW_SPLIT_MIN,
} from '@/lib/surfaces';

function resolveSplitMainEl(anchorEl: HTMLElement | null): HTMLElement | null {
  return anchorEl?.closest('main') ?? null;
}

/** 仅 main 持有 --sto-split-preview-col（统一 grid 唯一列宽来源） */
function applySplitColWidth(anchorEl: HTMLElement | null, value: string): void {
  const main = resolveSplitMainEl(anchorEl);
  if (main === null) return;
  main.style.setProperty('--sto-split-preview-col', value);
}

function percentToPx(containerWidth: number, percent: number): number {
  if (containerWidth <= 0) return 0;
  return (containerWidth * percent) / 100;
}

export function useSplitPanelResize(
  previewPanelPercent: number,
  setPreviewSplitPercent: (percent: number) => void,
) {
  const splitRowRef = useRef<HTMLDivElement>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const percentRef = useRef(previewPanelPercent);
  /** 刚结束拖拽：保留精确 px，跳过下一次 layout 同步 */
  const skipNextLayoutSyncRef = useRef(false);

  percentRef.current = previewPanelPercent;

  const syncPercentToDom = useCallback((percent: number) => {
    applySplitColWidth(splitRowRef.current, `${percent}%`);
  }, []);

  useLayoutEffect(() => {
    if (isResizingRef.current) return;
    if (skipNextLayoutSyncRef.current) {
      skipNextLayoutSyncRef.current = false;
      return;
    }
    syncPercentToDom(previewPanelPercent);
  }, [previewPanelPercent, syncPercentToDom]);

  // 窗口变宽时按持久化 % 重算 px（拖拽中跳过）
  useLayoutEffect(() => {
    const anchor = splitRowRef.current;
    if (!anchor) return undefined;

    const main = resolveSplitMainEl(anchor);
    if (main === null) return undefined;

    const syncFromGridWidth = () => {
      if (isResizingRef.current) return;
      const w = resolveSplitGridContainerWidth(anchor);
      if (w <= 0) return;
      applySplitColWidth(anchor, `${percentToPx(w, percentRef.current)}px`);
    };

    const ro = new ResizeObserver(syncFromGridWidth);
    ro.observe(main);
    syncFromGridWidth();
    return () => ro.disconnect();
  }, []);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = previewPanelRef.current?.offsetWidth ?? 0;
      const containerWidth =
        resolveSplitGridContainerWidth(splitRowRef.current) || window.innerWidth;
      let rafId: number | null = null;
      let pendingWidth = startWidth || percentToPx(containerWidth, previewPanelPercent);

      isResizingRef.current = true;
      setIsResizing(true);
      document.body.style.userSelect = 'none';

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;';
      document.body.appendChild(overlay);

      const applyWidth = () => {
        rafId = null;
        applySplitColWidth(splitRowRef.current, `${pendingWidth}px`);
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const width = resolveSplitGridContainerWidth(splitRowRef.current) || containerWidth;
        pendingWidth = Math.max(
          width * (STO_PREVIEW_SPLIT_MIN / 100),
          Math.min(width * (STO_PREVIEW_SPLIT_MAX / 100), startWidth + delta),
        );
        if (rafId === null) {
          rafId = requestAnimationFrame(applyWidth);
        }
      };

      const handleMouseUp = () => {
        overlay.removeEventListener('mousemove', handleMouseMove);
        overlay.removeEventListener('mouseup', handleMouseUp);
        overlay.remove();
        document.body.style.userSelect = '';
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        const containerW =
          resolveSplitGridContainerWidth(splitRowRef.current) || containerWidth;
        const newPercent = clampPreviewPanelPercent(containerW, pendingWidth);
        applySplitColWidth(splitRowRef.current, `${pendingWidth}px`);
        skipNextLayoutSyncRef.current = true;
        percentRef.current = newPercent;
        setPreviewSplitPercent(newPercent);
        isResizingRef.current = false;
        setIsResizing(false);
      };

      overlay.addEventListener('mousemove', handleMouseMove);
      overlay.addEventListener('mouseup', handleMouseUp);
    },
    [previewPanelPercent, setPreviewSplitPercent],
  );

  return { splitRowRef, previewPanelRef, startResize, isResizing };
}
