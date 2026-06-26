import { webContents, type WebContents } from 'electron';

function canSendToWebContents(target: WebContents): boolean {
  if (target.isDestroyed() || target.isCrashed()) return false;
  try {
    const frame = target.mainFrame;
    return Boolean(frame && !frame.isDestroyed());
  } catch {
    return false;
  }
}

/** Best-effort IPC push; ignores disposed/crashed renderer frames (e.g. Vite HMR reload). */
export function safeWebContentsSend(
  target: WebContents | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (!target || !canSendToWebContents(target)) return;
  try {
    target.send(channel, ...args);
  } catch {
    // Render frame may be disposed between the guard and send during dev reload.
  }
}

export function safeBroadcastToAllWebContents(channel: string, ...args: unknown[]): void {
  for (const target of webContents.getAllWebContents()) {
    safeWebContentsSend(target, channel, ...args);
  }
}
