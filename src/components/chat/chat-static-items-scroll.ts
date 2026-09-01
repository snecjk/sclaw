/** Near the top of a stick-to-bottom chat list. */
export const CHAT_HISTORY_SCROLL_TOP_PX = 64;
/** Near the latest messages. */
export const CHAT_HISTORY_SCROLL_BOTTOM_PX = 64;

export interface ChatScrollMetrics {
  overflow: boolean;
  atTop: boolean;
  atBottom: boolean;
}

export function measureChatScroll(
  el: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
): ChatScrollMetrics {
  const overflow = el.scrollHeight > el.clientHeight + 8;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  return {
    overflow,
    atTop: el.scrollTop <= CHAT_HISTORY_SCROLL_TOP_PX,
    atBottom: distanceFromBottom <= CHAT_HISTORY_SCROLL_BOTTOM_PX,
  };
}

/** Arm only after the list has overflowed and stuck to the latest messages. */
export function shouldArmOlderHistoryLoader(metrics: ChatScrollMetrics): boolean {
  return metrics.overflow && metrics.atBottom;
}

/**
 * Load older pages only when the user has scrolled to the top of a list that
 * is already following the bottom. Initial layout at index 0 is not enough —
 * stick-to-bottom starts there before jumping down.
 */
export function shouldLoadOlderHistoryFromScroll(
  armed: boolean,
  metrics: ChatScrollMetrics,
): boolean {
  return armed && metrics.atTop && !metrics.atBottom;
}

export type OlderHistoryScrollDecision = 'load' | 'idle';

/**
 * One trigger per visit to the top. After firing, wait until the user leaves
 * the top (or prepend restores them away from 0) so a single rest does not
 * drain every remaining page.
 */
export function createOlderHistoryScrollController(): {
  onMetrics: (metrics: ChatScrollMetrics) => OlderHistoryScrollDecision;
  reset: () => void;
} {
  let armed = false;
  let holdUntilLeaveTop = false;
  return {
    onMetrics(metrics) {
      if (!armed && shouldArmOlderHistoryLoader(metrics)) {
        armed = true;
      }
      if (holdUntilLeaveTop) {
        if (!metrics.atTop) holdUntilLeaveTop = false;
        return 'idle';
      }
      if (shouldLoadOlderHistoryFromScroll(armed, metrics)) {
        holdUntilLeaveTop = true;
        return 'load';
      }
      return 'idle';
    },
    reset() {
      armed = false;
      holdUntilLeaveTop = false;
    },
  };
}

export function restoreScrollAfterPrepend(
  el: Pick<HTMLElement, 'scrollTop' | 'scrollHeight'>,
  previousScrollHeight: number,
): number {
  const delta = el.scrollHeight - previousScrollHeight;
  if (delta > 0) el.scrollTop += delta;
  return el.scrollHeight;
}
