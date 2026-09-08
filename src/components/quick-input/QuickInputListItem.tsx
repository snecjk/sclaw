/**
 * 快捷输入列表单行：图标 + 截断标题，hover 右侧展示完整内容。
 *
 * 不用 Radix Tooltip：任务弹窗 AnimatePresence 的 PopChild 会与
 * DismissableLayer 的 setState-in-ref 互相触发，导致 Maximum update depth exceeded。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { QuickInputIcon } from '@/components/icons/composer-toolbar-icons';
import { SidebarSessionTitle } from '@/components/layout/sidebar-session-title';
import type { QuickInputItem } from './types';

const TOOLTIP_DELAY_MS = 200;
const TOOLTIP_OFFSET_PX = 8;

const itemTooltipClass =
  'pointer-events-none fixed z-[60000] max-w-[300px] overflow-visible rounded-[6px] border-none bg-black/90 px-2.5 py-1.5 text-xs font-normal leading-4 text-white shadow-none';

export interface QuickInputListItemProps {
  item: QuickInputItem;
  onSelect: (item: QuickInputItem) => void;
}

export function QuickInputListItem({ item, onSelect }: QuickInputListItemProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<{ top: number; left: number; placeLeft: boolean } | null>(null);

  const clearTimer = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const hide = () => {
    clearTimer();
    setTip(null);
  };

  const show = () => {
    clearTimer();
    showTimerRef.current = setTimeout(() => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const placeLeft = window.innerWidth - rect.right < 160;
      setTip({
        top: rect.top + rect.height / 2,
        left: placeLeft ? rect.left - TOOLTIP_OFFSET_PX : rect.right + TOOLTIP_OFFSET_PX,
        placeLeft,
      });
    }, TOOLTIP_DELAY_MS);
  };

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (!tip) return;
    const onDismiss = () => setTip(null);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [tip]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onSelect(item)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={cn(
          'sto-sidebar-session-title-trigger flex h-8 w-full items-center gap-1.5 self-stretch rounded-lg p-2 text-left transition-colors',
          'hover:bg-[#F0F2F5] dark:hover:bg-muted',
        )}
      >
        <QuickInputIcon className="h-[14px] w-[14px] shrink-0 text-[#111827] dark:text-foreground" />
        <SidebarSessionTitle
          label={item.title}
          className="text-xs font-normal leading-4 text-[#111827] dark:text-foreground"
        />
      </button>
      {tip
        ? createPortal(
            <div
              role="tooltip"
              className={itemTooltipClass}
              style={{
                top: tip.top,
                left: tip.left,
                transform: tip.placeLeft ? 'translate(-100%, -50%)' : 'translateY(-50%)',
              }}
            >
              <p className="whitespace-pre-wrap text-left">{item.content}</p>
              <span
                aria-hidden
                className={cn(
                  'absolute top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-y-transparent',
                  tip.placeLeft
                    ? 'right-0 translate-x-full border-l-[5px] border-l-black/90'
                    : 'left-0 -translate-x-full border-r-[5px] border-r-black/90',
                )}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
