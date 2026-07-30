/**
 * useNativeScrollbarActivity — 原生滚动条活动显隐
 *
 * 120ms scroll-stop debounce：
 * - scroll 立即显示，连续 120ms 无新 scroll 视为停止
 * - 停止且鼠标不在容器内 → 立即淡出
 * - 鼠标离开且未滚动 → 立即淡出
 * - 鼠标悬浮时，即使滚动停止也保持显示
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const ATTR = 'data-scrollbar-active';
const SCROLL_STOP_MS = 120;

export function useNativeScrollbarActivity(
  containerRef: RefObject<HTMLElement | null>,
): void {
  const hoveredRef = useRef(false);
  const scrollingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function setActive() {
      el!.setAttribute(ATTR, 'true');
    }

    function clearActive() {
      el!.removeAttribute(ATTR);
    }

    function cancelTimer() {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function onPointerEnter() {
      hoveredRef.current = true;
      setActive();
    }

    function onPointerLeave() {
      hoveredRef.current = false;
      if (!scrollingRef.current) {
        clearActive();
      }
    }

    function onScroll() {
      scrollingRef.current = true;
      setActive();
      cancelTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        scrollingRef.current = false;
        if (!hoveredRef.current) {
          clearActive();
        }
      }, SCROLL_STOP_MS);
    }

    el.addEventListener('pointerenter', onPointerEnter);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      el.removeEventListener('pointerenter', onPointerEnter);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('scroll', onScroll);
      cancelTimer();
      scrollingRef.current = false;
      hoveredRef.current = false;
      el.removeAttribute(ATTR);
    };
  }, [containerRef]);
}
