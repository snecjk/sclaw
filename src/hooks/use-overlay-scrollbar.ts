/**
 * useOverlayScrollbar — sync overlay track/thumb to a real scroll viewport.
 *
 * - No React state on the scroll hot path (DOM attributes + style only)
 * - 120ms scroll-stop debounce; fade is CSS (~150ms)
 * - Pointer drag on thumb only; track gutter does not jump
 *
 * Contract: docs/侧边栏与对话流Overlay滚动条-Cursor开发文档.md §5.3–5.6
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import {
  OVERLAY_SCROLLBAR_SCROLL_STOP_MS,
  calculateOverlayScrollbarMetrics,
  scrollTopFromThumbDelta,
} from '@/lib/overlay-scrollbar-metrics';

export interface UseOverlayScrollbarParams {
  viewportRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  rootRef: RefObject<HTMLElement | null>;
  trackRef: RefObject<HTMLElement | null>;
  thumbRef: RefObject<HTMLElement | null>;
}

function setAttr(el: HTMLElement | null, name: string, value: boolean) {
  if (!el) return;
  el.setAttribute(name, value ? 'true' : 'false');
}

export function useOverlayScrollbar({
  viewportRef,
  contentRef,
  rootRef,
  trackRef,
  thumbRef,
}: UseOverlayScrollbarParams): void {
  useEffect(() => {
    const viewportEl = viewportRef.current;
    const rootEl = rootRef.current;
    const trackEl = trackRef.current;
    const thumbEl = thumbRef.current;
    if (!viewportEl || !rootEl || !trackEl || !thumbEl) return;

    // Capture non-null locals for nested listeners (TS closure narrowing).
    const viewport: HTMLElement = viewportEl;
    const root: HTMLElement = rootEl;
    const track: HTMLElement = trackEl;
    const thumb: HTMLElement = thumbEl;

    let isScrolling = false;
    let isRailHovered = false;
    let isDragging = false;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let dragPointerId: number | null = null;
    let dragStartY = 0;
    let dragStartScrollTop = 0;
    let dragMaxScrollTop = 0;
    let dragMaxThumbTop = 0;

    function cancelStopTimer() {
      if (stopTimer !== null) {
        clearTimeout(stopTimer);
        stopTimer = null;
      }
    }

    function syncActive() {
      const hasOverflow = root.getAttribute('data-overflow') === 'true';
      const active =
        hasOverflow && (isScrolling || isRailHovered || isDragging);
      setAttr(root, 'data-active', active);
      setAttr(root, 'data-dragging', isDragging);
    }

    function applyMetrics() {
      const trackHeight = track.clientHeight;
      const metrics = calculateOverlayScrollbarMetrics({
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
        trackHeight,
      });

      setAttr(root, 'data-overflow', metrics.hasOverflow);

      if (!metrics.hasOverflow) {
        thumb.style.height = '0px';
        thumb.style.transform = 'translate3d(0,0,0)';
        if (!isDragging) {
          isScrolling = false;
          isRailHovered = false;
        }
        syncActive();
        return;
      }

      thumb.style.height = `${metrics.thumbHeight}px`;
      thumb.style.transform = `translate3d(0,${metrics.thumbTop}px,0)`;
      syncActive();
    }

    function scheduleMetrics() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        applyMetrics();
      });
    }

    function onScroll() {
      isScrolling = true;
      syncActive();
      scheduleMetrics();
      cancelStopTimer();
      stopTimer = setTimeout(() => {
        stopTimer = null;
        isScrolling = false;
        syncActive();
      }, OVERLAY_SCROLLBAR_SCROLL_STOP_MS);
    }

    function onRailEnter() {
      isRailHovered = true;
      syncActive();
    }

    function onRailLeave() {
      isRailHovered = false;
      syncActive();
    }

    function endDrag(pointerId: number | null) {
      if (!isDragging) return;
      isDragging = false;
      if (pointerId !== null && thumb.hasPointerCapture?.(pointerId)) {
        try {
          thumb.releasePointerCapture(pointerId);
        } catch {
          // ignore release failures in test / already released
        }
      }
      dragPointerId = null;
      syncActive();
      scheduleMetrics();
    }

    function onThumbPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      if (root.getAttribute('data-overflow') !== 'true') return;
      event.preventDefault();
      event.stopPropagation();

      const metrics = calculateOverlayScrollbarMetrics({
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
        trackHeight: track.clientHeight,
      });
      if (!metrics.hasOverflow) return;

      isDragging = true;
      dragPointerId = event.pointerId;
      dragStartY = event.clientY;
      dragStartScrollTop = viewport.scrollTop;
      dragMaxScrollTop = metrics.maxScrollTop;
      dragMaxThumbTop = metrics.maxThumbTop;
      syncActive();

      try {
        thumb.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / environments without capture
      }
    }

    function onThumbPointerMove(event: PointerEvent) {
      if (!isDragging || event.pointerId !== dragPointerId) return;
      const next = scrollTopFromThumbDelta({
        startScrollTop: dragStartScrollTop,
        deltaY: event.clientY - dragStartY,
        maxScrollTop: dragMaxScrollTop,
        maxThumbTop: dragMaxThumbTop,
      });
      viewport.scrollTop = next;
      scheduleMetrics();
    }

    function onThumbPointerUp(event: PointerEvent) {
      if (event.pointerId !== dragPointerId) return;
      endDrag(event.pointerId);
    }

    function onWindowBlur() {
      endDrag(dragPointerId);
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleMetrics();
    });
    resizeObserver.observe(viewport);
    const content = contentRef.current;
    if (content) {
      resizeObserver.observe(content);
    }
    resizeObserver.observe(track);

    viewport.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('pointerenter', onRailEnter);
    track.addEventListener('pointerleave', onRailLeave);
    thumb.addEventListener('pointerdown', onThumbPointerDown);
    thumb.addEventListener('pointermove', onThumbPointerMove);
    thumb.addEventListener('pointerup', onThumbPointerUp);
    thumb.addEventListener('pointercancel', onThumbPointerUp);
    window.addEventListener('blur', onWindowBlur);

    applyMetrics();

    return () => {
      cancelStopTimer();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      endDrag(dragPointerId);
      resizeObserver.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      track.removeEventListener('pointerenter', onRailEnter);
      track.removeEventListener('pointerleave', onRailLeave);
      thumb.removeEventListener('pointerdown', onThumbPointerDown);
      thumb.removeEventListener('pointermove', onThumbPointerMove);
      thumb.removeEventListener('pointerup', onThumbPointerUp);
      thumb.removeEventListener('pointercancel', onThumbPointerUp);
      window.removeEventListener('blur', onWindowBlur);
      setAttr(root, 'data-overflow', false);
      setAttr(root, 'data-active', false);
      setAttr(root, 'data-dragging', false);
    };
  }, [viewportRef, contentRef, rootRef, trackRef, thumbRef]);
}
