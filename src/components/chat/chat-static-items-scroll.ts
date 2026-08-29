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
