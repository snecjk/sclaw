import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ScrollToBottom, StopScroll } from 'use-stick-to-bottom';

const USER_MESSAGE_SELECTOR = '[data-chat-message-role="user"]';
const SCROLL_AWAY_THRESHOLD_PX = 240;
const ANCHOR_TOP_INSET_PX = 8;
/** 语音 waiting 面板较高时，保证气泡底边与滚动区底边留白 */
const VOICE_PANEL_BOTTOM_CLEARANCE_PX = 28;

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
  /** 语音循环仍占着较高输入面板时，发送后额外补一次滚动留白 */
  voiceComposerElevated = false,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  scrollToBottom: ScrollToBottomFn;
  stopScroll: StopScroll;
  sending: boolean;
  lastUserMessageAt: number | null;
  hasStreamContent: boolean;
  streamContentKey: string;
  voiceComposerElevated?: boolean;
}) {
  const followStreamRef = useRef(false);
  const anchorPendingRef = useRef(false);
  const userScrolledAwayRef = useRef(false);
  const voiceClearancePendingRef = useRef(false);

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

  /** 若最新用户气泡底边超出滚动区，向下滚出 clearance，避免被高输入面板「盖住」 */
  const ensureLastUserMessageClearOfBottom = useCallback(
    (clearancePx = VOICE_PANEL_BOTTOM_CLEARANCE_PX, behavior: ScrollBehavior = 'smooth') => {
      const container = scrollRef.current;
      const content = contentRef.current;
      if (!container || !content) return false;

      const nodes = content.querySelectorAll(USER_MESSAGE_SELECTOR);
      const last = nodes[nodes.length - 1] as HTMLElement | undefined;
      if (!last) return false;

      const containerBottom = container.getBoundingClientRect().bottom;
      const messageBottom = last.getBoundingClientRect().bottom;
      const overflow = messageBottom - (containerBottom - clearancePx);
      if (overflow <= 2) return true;

      container.scrollBy({ top: overflow, behavior });
      return true;
    },
    [scrollRef, contentRef],
  );

  const beginSendScroll = useCallback(() => {
    stopScroll();
    followStreamRef.current = true;
    userScrolledAwayRef.current = false;
    anchorPendingRef.current = true;
    if (voiceComposerElevated) {
      voiceClearancePendingRef.current = true;
    }
  }, [stopScroll, voiceComposerElevated]);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      stopScroll();
      followStreamRef.current = false;
      anchorPendingRef.current = false;
      voiceClearancePendingRef.current = false;
      const result = scrollToBottom(behavior === 'smooth' ? 'smooth' : 'instant');
      if (result instanceof Promise) void result;
    },
    [scrollToBottom, stopScroll],
  );

  useEffect(() => {
    if (!anchorPendingRef.current || lastUserMessageAt == null) return;

    let cancelled = false;
    const tryAnchor = () => {
      if (cancelled || !anchorPendingRef.current) return;
      if (scrollLastUserMessageToTop('smooth')) anchorPendingRef.current = false;
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(tryAnchor));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [lastUserMessageAt, scrollLastUserMessageToTop]);

  // 语音高面板：锚点后再补一次，把气泡底边滚进可视区并留白
  useEffect(() => {
    if (!voiceClearancePendingRef.current || !voiceComposerElevated) return;
    if (lastUserMessageAt == null) return;

    let cancelled = false;
    const timers: number[] = [];
    const run = () => {
      if (cancelled || !voiceClearancePendingRef.current) return;
      if (ensureLastUserMessageClearOfBottom(VOICE_PANEL_BOTTOM_CLEARANCE_PX, 'smooth')) {
        voiceClearancePendingRef.current = false;
      }
    };

    // 等消息挂载 + 语音 waiting 面板高度稳定
    timers.push(window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(run));
    }, 80));
    timers.push(window.setTimeout(run, 220));

    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
    };
  }, [ensureLastUserMessageClearOfBottom, lastUserMessageAt, voiceComposerElevated, sending]);

  useEffect(() => {
    if (!sending || !followStreamRef.current || userScrolledAwayRef.current) return;
    if (!hasStreamContent) return;

    stopScroll();
    const result = scrollToBottom('instant');
    if (result instanceof Promise) void result;
  }, [sending, hasStreamContent, streamContentKey, scrollToBottom, stopScroll]);

  useEffect(() => {
    if (!sending) {
      followStreamRef.current = false;
      anchorPendingRef.current = false;
      voiceClearancePendingRef.current = false;
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

  return {
    beginSendScroll,
    scrollToLatest,
    scrollLastUserMessageToTop,
    ensureLastUserMessageClearOfBottom,
  };
}
