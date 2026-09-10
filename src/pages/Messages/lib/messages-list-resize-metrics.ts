/** IM 左侧会话/通讯录列表宽度：默认 280，可拖范围 240–400 */
export const MESSAGES_LIST_MIN_WIDTH = 240;
export const MESSAGES_LIST_DEFAULT_WIDTH = 280;
export const MESSAGES_LIST_MAX_WIDTH = 400;
export const MESSAGES_LIST_KEYBOARD_STEP = 8;

export function clampMessagesListWidth(width: number): number {
  if (!Number.isFinite(width)) return MESSAGES_LIST_DEFAULT_WIDTH;
  return Math.min(
    MESSAGES_LIST_MAX_WIDTH,
    Math.max(MESSAGES_LIST_MIN_WIDTH, Math.round(width)),
  );
}
