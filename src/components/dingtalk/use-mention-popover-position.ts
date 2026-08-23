import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ActiveMentionTrigger } from '@/lib/dingtalk-mention-composer';
import { resolveMentionPopoverAnchorRect } from './mention-popover-anchor-rect';
import {
  computeMentionPopoverPlacement,
  type MentionPopoverPlacement,
} from './mention-popover-placement';

export interface UseMentionPopoverPositionOptions {
  open: boolean;
  /** portal 模式：有则启用 fixed 定位 */
  anchorRef?: RefObject<HTMLElement | null>;
  mentionTrigger?: ActiveMentionTrigger | null;
  getEditorElement?: () => HTMLElement | null;
}

/**
 * 跟踪 @ 联系人浮层 portal 坐标：光标优先，scroll/resize 时 rAF 节流重算。
 * 首帧同步测量，避免 portal 模式晚一帧才出现。
 */
export function useMentionPopoverPosition({
  open,
  anchorRef,
  mentionTrigger,
  getEditorElement,
}: UseMentionPopoverPositionOptions): MentionPopoverPlacement | null {
  const [position, setPosition] = useState<MentionPopoverPlacement | null>(null);
  const rafRef = useRef<number | null>(null);
  const mentionTriggerRef = useRef(mentionTrigger);
  const getEditorElementRef = useRef(getEditorElement);
  mentionTriggerRef.current = mentionTrigger;
  getEditorElementRef.current = getEditorElement;

  const triggerKey = mentionTrigger
    ? `${mentionTrigger.startOffset}:${mentionTrigger.endOffset}:${mentionTrigger.query}`
    : '';

  const measurePosition = useCallback(() => {
    const host = anchorRef?.current;
    if (!host) return;

    const anchorRect = resolveMentionPopoverAnchorRect(
      getEditorElementRef.current?.() ?? null,
      mentionTriggerRef.current ?? null,
      host,
    );
    if (!anchorRect) return;

    setPosition(computeMentionPopoverPlacement({
      caretRect: anchorRect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
  }, [anchorRef]);

  // 打开 / trigger 变化：同步测量，保证首帧即有 position
  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setPosition(null);
      return;
    }
    measurePosition();
  }, [anchorRef, measurePosition, open, triggerKey]);

  // scroll / resize：rAF 节流，监听仅在 open 切换时增删
  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) return;

    const scheduleUpdate = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        measurePosition();
      });
    };

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, { capture: true });
    };
  }, [anchorRef, measurePosition, open]);

  return position;
}
