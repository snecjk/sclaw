import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatDisplayItem } from '@/pages/Chat/chat-display';
import { buildChatTurnNavigationEntries } from './chat-turn-navigation';
import { cn } from '@/lib/utils';

interface ChatTurnNavigatorProps {
  items: ChatDisplayItem[];
  scrollRef: RefObject<HTMLElement | null>;
  sessionKey: string;
  onNavigate: (itemKey: string) => void;
}

const MINIMUM_TURN_COUNT = 3;

export function ChatTurnNavigator({
  items,
  scrollRef,
  sessionKey,
  onNavigate,
}: ChatTurnNavigatorProps) {
  const { t } = useTranslation('chat');
  const entries = useMemo(() => buildChatTurnNavigationEntries(items), [items]);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isRailFocused, setIsRailFocused] = useState(false);
  const frameRef = useRef<number | null>(null);

  const updateMetrics = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const overflow = viewport.scrollHeight > viewport.clientHeight + 8;
    setHasOverflow(overflow);
    if (!overflow || entries.length === 0) return;
    const travel = Math.max(1, viewport.scrollHeight - viewport.clientHeight);
    const progress = Math.min(1, Math.max(0, (viewport.scrollTop + viewport.clientHeight * 0.28) / travel));
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    entries.forEach((entry, index) => {
      const nextDistance = Math.abs(entry.position - progress);
      if (nextDistance < distance) {
        closest = index;
        distance = nextDistance;
      }
    });
    setActiveIndex(closest);
  }, [entries, scrollRef]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const schedule = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateMetrics();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    viewport.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      viewport.removeEventListener('scroll', schedule);
      observer.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [scrollRef, sessionKey, updateMetrics]);

  if (!hasOverflow || entries.length < MINIMUM_TURN_COUNT) return null;
  const preview = entries[previewIndex ?? activeIndex];
  const focusedIndex = previewIndex ?? activeIndex;

  const resolveLineWidth = (index: number) => {
    if (!isRailFocused) return 8;
    const distance = Math.abs(index - focusedIndex);
    if (distance === 0) return 38;
    if (distance === 1) return 28;
    if (distance === 2) return 20;
    if (distance === 3) return 14;
    return 9;
  };

  const findNearestIndex = (rail: HTMLElement, clientY: number) => {
    const buttons = Array.from(rail.querySelectorAll<HTMLButtonElement>('button'));
    if (buttons.length === 0) return -1;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    buttons.forEach((button, index) => {
      const bounds = button.getBoundingClientRect();
      const distance = Math.abs(bounds.top + bounds.height / 2 - clientY);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    return nearestIndex;
  };

  const updateNearestPreview = (rail: HTMLElement, clientY: number) => {
    const nearestIndex = findNearestIndex(rail, clientY);
    if (nearestIndex < 0) return;
    setPreviewIndex((current) => current === nearestIndex ? current : nearestIndex);
  };

  return (
    <div className="pointer-events-none absolute left-3 top-1/2 z-30 hidden w-8 -translate-y-1/2 min-[720px]:block">
      {preview && previewIndex !== null ? (
        <div className="sto-control sto-control--floating-action pointer-events-none absolute left-10 top-1/2 w-[280px] -translate-y-1/2 rounded-[18px] border px-3 py-2.5 text-left">
          <p className="line-clamp-2 text-[13px] font-medium leading-5 text-[var(--sto-text-primary)]">{preview.prompt}</p>
        </div>
      ) : null}
      <div
        className="pointer-events-auto flex w-full flex-col gap-2"
        onPointerEnter={(event) => {
          setIsRailFocused(true);
          updateNearestPreview(event.currentTarget, event.clientY);
        }}
        onPointerMove={(event) => updateNearestPreview(event.currentTarget, event.clientY)}
        onClick={(event) => {
          const nearestIndex = findNearestIndex(event.currentTarget, event.clientY);
          const target = entries[nearestIndex];
          if (!target) return;
          setPreviewIndex(nearestIndex);
          onNavigate(target.targetItemKey);
        }}
        onPointerLeave={() => {
          setIsRailFocused(false);
          setPreviewIndex(null);
        }}
        onFocusCapture={() => setIsRailFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsRailFocused(false);
        }}
      >
        {entries.map((entry, index) => (
          <button
            key={entry.key}
            type="button"
            aria-label={t('navigator.jumpToTurn', { count: index + 1, prompt: entry.prompt })}
            onClick={(event) => {
              event.stopPropagation();
              onNavigate(entry.targetItemKey);
            }}
            onFocus={() => setPreviewIndex(index)}
            onBlur={() => setPreviewIndex(null)}
            onPointerEnter={() => setPreviewIndex(index)}
            style={{ width: `${resolveLineWidth(index)}px` }}
            className={cn(
              'block h-0.5 rounded-full bg-[var(--sto-border-heavy)] transition-[width,background-color] duration-150',
              index === activeIndex && 'bg-[var(--sto-brand-primary)]',
              'hover:bg-[var(--sto-text-secondary)] focus-visible:bg-[var(--sto-brand-primary)] focus-visible:outline-none',
            )}
          />
        ))}
      </div>
    </div>
  );
}
