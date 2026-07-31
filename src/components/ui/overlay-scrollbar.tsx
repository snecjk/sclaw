/**
 * OverlayScrollbar — absolute track/thumb sibling for a real scroll viewport.
 *
 * Does not own scrolling. Consumers wrap their existing viewport + content refs:
 *
 * ```tsx
 * <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
 *   <div ref={viewportRef} className="sto-overlay-scroll-viewport min-h-0 flex-1 overflow-y-auto">
 *     <div ref={contentRef}>{children}</div>
 *   </div>
 *   <OverlayScrollbar viewportRef={viewportRef} contentRef={contentRef} />
 * </div>
 * ```
 *
 * Host 必须同时是受限高度的 flex item 和 flex column；缺少 flex/flex-col 会让 viewport 的 flex-1 失效，
 * 缺少 overflow-hidden 会导致消息越过 composer 边界。
 *
 * `className` is for positioning only — do not override thumb size/color/timing.
 */
import { useRef } from 'react';
import type { RefObject } from 'react';
import { useOverlayScrollbar } from '@/hooks/use-overlay-scrollbar';
import { cn } from '@/lib/utils';

export interface OverlayScrollbarProps {
  /** Sole real scroll viewport (scrollTop / clientHeight / scrollHeight owner). */
  viewportRef: RefObject<HTMLElement | null>;
  /** Single content measure root inside the viewport (ResizeObserver). */
  contentRef: RefObject<HTMLElement | null>;
  /** Optional positioning overrides only. */
  className?: string;
}

export function OverlayScrollbar({
  viewportRef,
  contentRef,
  className,
}: OverlayScrollbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useOverlayScrollbar({
    viewportRef,
    contentRef,
    rootRef,
    trackRef,
    thumbRef,
  });

  return (
    <div
      ref={rootRef}
      className={cn('sto-overlay-scrollbar', className)}
      aria-hidden="true"
      data-overflow="false"
      data-active="false"
      data-dragging="false"
    >
      <div ref={trackRef} className="sto-overlay-scrollbar-rail">
        <div ref={thumbRef} className="sto-overlay-scrollbar-thumb" />
      </div>
    </div>
  );
}
