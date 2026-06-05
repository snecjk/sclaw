import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ScrollToBottom, StopScroll } from 'use-stick-to-bottom';

const USER_MESSAGE_SELECTOR = '[data-chat-message-role="user"]';
const SCROLL_AWAY_THRESHOLD_PX = 240;
const ANCHOR_TOP_INSET_PX = 8;

type ScrollToBottomFn = ScrollToBottom;

export function useChatScrollFollow({
  scrollRef,
  contentRef,
  scrollToBottom,
  stopScroll,
  sending,
  lastUserMessageAt,
  hasStreamContent,
  streamContentKey,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  scrollToBottom: ScrollToBottomFn;
  stopScroll: StopScroll;
  sending: boolean;
  lastUserMessageAt: number | null;
  hasStreamContent: boolean;
  streamContentKey: string;
}) {
  const followStreamRef = useRef(false);
  const anchorPendingRef = useRef(false);
  const userScrolledAwayRef = useRef(false);

  const scrollLastUserMessageToTop = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const container = scrollRef.current;
      const content = contentRef.current;
      if (!container || !content) return false;

      const nodes = content.querySelectorAll(USER_MESSAGE_SELECTOR);
      const last = nodes[nodes.length - 1] as HTMLElement | undefined;
      if (!last) return false;

      const delta =
        last.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        ANCHOR_TOP_INSET_PX;

      if (Math.abs(delta) < 2) return true;

      container.scrollBy({ top: delta, behavior });
      return true;
    },
    [scrollRef, contentRef],
  );

  const beginSendScroll = useCallback(() => {
    stopScroll();
    followStreamRef.current = true;
    userScrolledAwayRef.current = false;
    anchorPendingRef.current = true;
  }, [stopScroll]);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      stopScroll();
      followStreamRef.current = false;
      anchorPendingRef.current = false;
      const result = scrollToBottom(behavior === 'smooth' ? 'smooth' : 'instant');
      if (result instanceof Promise) {
        void result;
      }
    },
    [scrollToBottom, stopScroll],
  );

  // Pin the newest user message near the top after send (WorkBuddy-style).
  useEffect(() => {
    if (!anchorPendingRef.current || lastUserMessageAt == null) return;

    let cancelled = false;
    const tryAnchor = () => {
      if (cancelled || !anchorPendingRef.current) return;
      if (scrollLastUserMessageToTop('smooth')) {
        anchorPendingRef.current = false;
      }
    };

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(tryAnchor);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [lastUserMessageAt, scrollLastUserMessageToTop]);

  // Follow streaming output downward while the user has not scrolled away.
  useEffect(() => {
    if (!sending || !followStreamRef.current || userScrolledAwayRef.current) return;
    if (!hasStreamContent) return;

    stopScroll();
    const result = scrollToBottom('instant');
    if (result instanceof Promise) {
      void result;
    }
  }, [sending, hasStreamContent, streamContentKey, scrollToBottom, stopScroll]);

  useEffect(() => {
    if (!sending) {
      followStreamRef.current = false;
      anchorPendingRef.current = false;
    }
  }, [sending]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (!sending || !followStreamRef.current) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom > SCROLL_AWAY_THRESHOLD_PX) {
        userScrolledAwayRef.current = true;
        followStreamRef.current = false;
        stopScroll();
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, sending, stopScroll]);

  return { beginSendScroll, scrollToLatest, scrollLastUserMessageToTop };
}
