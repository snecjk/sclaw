import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { cn } from '@/lib/utils';

const SCROLL_SPEED_PX_PER_SECOND = 6;
const MIN_DURATION_SECONDS = 2;

interface SidebarSessionTitleProps {
  label: string;
  className?: string;
}

type MarqueeStyle = CSSProperties & {
  '--sto-sidebar-title-distance'?: string;
  '--sto-sidebar-title-duration'?: string;
};

/**
 * A single-line session title that stays truncated at rest and scrolls to its
 * end on pointer hover or keyboard focus only when its text actually overflows.
 */
export function SidebarSessionTitle({ label, className }: SidebarSessionTitleProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [marqueeStyle, setMarqueeStyle] = useState<MarqueeStyle | null>(null);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;

    const textWidth = Math.ceil(text.getBoundingClientRect().width);
    const viewportWidth = Math.ceil(viewport.clientWidth);
    const isOverflowing = textWidth > viewportWidth + 1;

    if (!isOverflowing) {
      setMarqueeStyle((current) => (current === null ? current : null));
      return;
    }

    const distance = textWidth - viewportWidth;
    const duration = Math.max(
      MIN_DURATION_SECONDS,
      distance / SCROLL_SPEED_PX_PER_SECOND,
    );
    const nextStyle: MarqueeStyle = {
      '--sto-sidebar-title-distance': `${distance}px`,
      '--sto-sidebar-title-duration': `${duration}s`,
    };

    setMarqueeStyle((current) => (
      current?.['--sto-sidebar-title-distance'] === nextStyle['--sto-sidebar-title-distance']
      && current?.['--sto-sidebar-title-duration'] === nextStyle['--sto-sidebar-title-duration']
        ? current
        : nextStyle
    ));
  }, []);

  useLayoutEffect(() => {
    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (textRef.current) observer.observe(textRef.current);
    return () => observer.disconnect();
  }, [label, measure]);

  const isOverflowing = marqueeStyle !== null;

  return (
    <span
      ref={viewportRef}
      data-overflow={isOverflowing ? 'true' : undefined}
      className={cn('sto-sidebar-session-title min-w-0 flex-1 overflow-hidden', className)}
    >
      <span
        className={cn(
          'sto-sidebar-session-title__track',
          isOverflowing ? 'block w-max' : 'block truncate',
        )}
        style={marqueeStyle ?? undefined}
      >
        <span ref={textRef}>
          {label}
        </span>
      </span>
    </span>
  );
}
