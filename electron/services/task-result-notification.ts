import { BrowserWindow, Notification } from 'electron';
import { getClientAppIcon } from '../main/app-icon';
import { logger } from '../utils/logger';

export interface TaskResultNotificationOptions {
  id: string;
  title: string;
  body: string;
  onClick?: () => void;
}

const deliveredNotificationIds = new Set<string>();
const activeNotifications = new Set<Notification>();
const MAX_DELIVERED_NOTIFICATION_IDS = 1_000;

export function hasForegroundAppWindow(
  windows: Array<Pick<BrowserWindow, 'isDestroyed' | 'isFocused' | 'isMinimized' | 'isVisible'>>,
): boolean {
  return windows.some((window) => (
    !window.isDestroyed()
    && window.isVisible()
    && !window.isMinimized()
    && window.isFocused()
  ));
}

function claimNotification(id: string): boolean {
  if (deliveredNotificationIds.has(id)) return false;
  deliveredNotificationIds.add(id);
  if (deliveredNotificationIds.size > MAX_DELIVERED_NOTIFICATION_IDS) {
    const oldest = deliveredNotificationIds.values().next().value;
    if (typeof oldest === 'string') deliveredNotificationIds.delete(oldest);
  }
  return true;
}

/** Main-process native notification for background task terminal results. */
export function notifyTaskResult(
  targetWindow: BrowserWindow | null,
  options: TaskResultNotificationOptions,
): void {
  if (!options.id.trim() || !claimNotification(options.id)) return;
  if (hasForegroundAppWindow(BrowserWindow.getAllWindows())) {
    logger.debug('[task-result-notification] suppressed while app is foreground', { id: options.id });
    return;
  }
  if (!Notification.isSupported()) {
    logger.warn('[task-result-notification] native notifications are unsupported', { id: options.id });
    return;
  }

  const notification = new Notification({
    title: options.title,
    body: options.body,
    // Windows renders this field as a large content image. Omitting it lets the
    // registered SClaw identity own the compact icon in the top attribution row.
    ...(process.platform === 'win32' ? {} : { icon: getClientAppIcon() }),
  });
  const release = () => activeNotifications.delete(notification);
  activeNotifications.add(notification);
  notification.on('click', () => {
    release();
    logger.info('[task-result-notification] clicked', { id: options.id });
    if (!targetWindow || targetWindow.isDestroyed()) return;
    if (targetWindow.isMinimized()) targetWindow.restore();
    targetWindow.show();
    targetWindow.focus();
    options.onClick?.();
  });
  notification.on('close', release);
  notification.on('failed', release);
  notification.show();
  logger.info('[task-result-notification] shown', { id: options.id });
}

export function resetTaskResultNotificationDedupeForTest(): void {
  deliveredNotificationIds.clear();
  activeNotifications.clear();
}
