import { cn } from '@/lib/utils';

/** 建站工作台：右侧会话宽度占容器百分比下限 / 默认 / 上限 */
export const APP_DEV_CHAT_SPLIT_MIN = 22;
export const APP_DEV_CHAT_SPLIT_DEFAULT = 28;
export const APP_DEV_CHAT_SPLIT_MAX = 55;
export const APP_DEV_CHAT_SPLIT_MIN_PX = 280;

export const APP_DEV_CHAT_SPLIT_STORAGE_KEY = 'stoclaw:app-dev-chat-split-percent';
export const APP_DEV_CHAT_SPLIT_CSS_VAR = '--app-dev-chat-col';
export const APP_DEV_SPLIT_RESIZE_SHIELD_ID = 'app-dev-split-resize-shield';

export const appDevSplitRowClass = cn(
  'grid min-h-0 min-w-0 flex-1 overflow-hidden',
  'grid-cols-[minmax(0,1fr)_minmax(280px,var(--app-dev-chat-col,28%))]',
);

export function clampAppDevChatSplitPercent(percent: number): number {
  if (!Number.isFinite(percent)) return APP_DEV_CHAT_SPLIT_DEFAULT;
  const rounded = Math.round(percent * 10) / 10;
  return Math.max(APP_DEV_CHAT_SPLIT_MIN, Math.min(APP_DEV_CHAT_SPLIT_MAX, rounded));
}

/** 拖动中的会话像素宽：下限 max(280px, 22%)，上限 55%。窄窗口时以上限为准。 */
export function clampAppDevChatWidthPx(containerWidth: number, chatPx: number): number {
  if (containerWidth <= 0) return 0;
  const minPx = Math.max(
    APP_DEV_CHAT_SPLIT_MIN_PX,
    containerWidth * (APP_DEV_CHAT_SPLIT_MIN / 100),
  );
  const maxPx = containerWidth * (APP_DEV_CHAT_SPLIT_MAX / 100);
  if (minPx >= maxPx) return maxPx;
  return Math.max(minPx, Math.min(maxPx, chatPx));
}

/** 把会话像素宽换成百分比，并夹在 22%–55%。 */
export function clampAppDevChatSplitFromPx(containerWidth: number, chatPx: number): number {
  if (containerWidth <= 0) return APP_DEV_CHAT_SPLIT_DEFAULT;
  return clampAppDevChatSplitPercent(
    (clampAppDevChatWidthPx(containerWidth, chatPx) / containerWidth) * 100,
  );
}

export function readStoredAppDevChatSplitPercent(): number {
  if (typeof localStorage === 'undefined') return APP_DEV_CHAT_SPLIT_DEFAULT;
  try {
    const raw = localStorage.getItem(APP_DEV_CHAT_SPLIT_STORAGE_KEY);
    if (raw == null || raw === '') return APP_DEV_CHAT_SPLIT_DEFAULT;
    return clampAppDevChatSplitPercent(Number(raw));
  } catch {
    return APP_DEV_CHAT_SPLIT_DEFAULT;
  }
}

export function writeStoredAppDevChatSplitPercent(percent: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      APP_DEV_CHAT_SPLIT_STORAGE_KEY,
      String(clampAppDevChatSplitPercent(percent)),
    );
  } catch {
    // ignore quota / private mode
  }
}

export function applyAppDevChatColWidth(root: HTMLElement | null, value: string): void {
  if (!root) return;
  root.style.setProperty(APP_DEV_CHAT_SPLIT_CSS_VAR, value);
}
