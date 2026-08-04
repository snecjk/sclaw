/**
 * Overlay scrollbar geometry — pure helpers only (no DOM).
 *
 * Contract: docs/侧边栏与对话流Overlay滚动条-Cursor开发文档.md §5.2
 */

export const OVERLAY_SCROLLBAR_MIN_THUMB_HEIGHT = 32;
export const OVERLAY_SCROLLBAR_SCROLL_STOP_MS = 120;
export const OVERLAY_SCROLLBAR_RAIL_WIDTH_PX = 10;
export const OVERLAY_SCROLLBAR_THUMB_WIDTH_PX = 6;
export const OVERLAY_SCROLLBAR_VERTICAL_INSET_PX = 4;

export interface OverlayScrollbarMetricsInput {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  trackHeight: number;
  minThumbHeight?: number;
}

export interface OverlayScrollbarMetrics {
  hasOverflow: boolean;
  thumbHeight: number;
  thumbTop: number;
  maxScrollTop: number;
  maxThumbTop: number;
}

const ZERO_METRICS: OverlayScrollbarMetrics = {
  hasOverflow: false,
  thumbHeight: 0,
  thumbTop: 0,
  maxScrollTop: 0,
  maxThumbTop: 0,
};

function isFiniteNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute thumb size/position from viewport + track metrics.
 * Non-finite or negative sizes degrade to a zero / no-overflow result.
 */
export function calculateOverlayScrollbarMetrics(
  input: OverlayScrollbarMetricsInput,
): OverlayScrollbarMetrics {
  const {
    scrollTop,
    scrollHeight,
    clientHeight,
    trackHeight,
    minThumbHeight = OVERLAY_SCROLLBAR_MIN_THUMB_HEIGHT,
  } = input;

  if (
    !isFiniteNonNegative(scrollHeight) ||
    !isFiniteNonNegative(clientHeight) ||
    !isFiniteNonNegative(trackHeight) ||
    !Number.isFinite(scrollTop) ||
    !isFiniteNonNegative(minThumbHeight)
  ) {
    return { ...ZERO_METRICS };
  }

  if (scrollHeight <= clientHeight || trackHeight <= 0 || clientHeight <= 0) {
    return { ...ZERO_METRICS };
  }

  const maxScrollTop = scrollHeight - clientHeight;
  const ratio = clientHeight / scrollHeight;
  const thumbHeight = clamp(trackHeight * ratio, Math.min(minThumbHeight, trackHeight), trackHeight);
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const safeScrollTop = clamp(scrollTop, 0, maxScrollTop);
  const thumbTop =
    maxScrollTop > 0 ? (safeScrollTop / maxScrollTop) * maxThumbTop : 0;

  return {
    hasOverflow: true,
    thumbHeight,
    thumbTop,
    maxScrollTop,
    maxThumbTop,
  };
}

/**
 * Map a pointer drag delta on the thumb to a new scrollTop.
 */
export function scrollTopFromThumbDelta(input: {
  startScrollTop: number;
  deltaY: number;
  maxScrollTop: number;
  maxThumbTop: number;
}): number {
  const { startScrollTop, deltaY, maxScrollTop, maxThumbTop } = input;
  if (
    !Number.isFinite(startScrollTop) ||
    !Number.isFinite(deltaY) ||
    !isFiniteNonNegative(maxScrollTop) ||
    !isFiniteNonNegative(maxThumbTop)
  ) {
    return 0;
  }
  if (maxThumbTop <= 0 || maxScrollTop <= 0) {
    return clamp(startScrollTop, 0, maxScrollTop);
  }
  const next = startScrollTop + (deltaY / maxThumbTop) * maxScrollTop;
  return clamp(next, 0, maxScrollTop);
}
