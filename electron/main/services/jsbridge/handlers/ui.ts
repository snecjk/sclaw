import { BrowserWindow, webContents } from 'electron';
import type { BridgeHandlerFn } from './types';

function resolveHostWebContents(guestWebContentsId: number) {
  const guest = webContents.fromId(guestWebContentsId);
  const host = guest && !guest.isDestroyed()
    ? (guest as Electron.WebContents & { hostWebContents?: Electron.WebContents | null }).hostWebContents
    : null;
  if (host && !host.isDestroyed()) return host;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused.webContents;
  const candidate = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  return candidate?.webContents ?? null;
}

export const handleUiToast: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as { message?: string; level?: string } | undefined;
  const message = typeof params?.message === 'string' ? params.message.trim() : '';
  if (!message) {
    throw Object.assign(new Error('message is required'), { code: 'INVALID_PARAMS' });
  }
  const host = resolveHostWebContents(session.webContentsId);
  if (!host || host.isDestroyed()) {
    throw Object.assign(new Error('Host window unavailable'), { code: 'INTERNAL_ERROR' });
  }
  host.send('jsbridge:toast', {
    message,
    level: typeof params?.level === 'string' ? params.level : 'info',
  });
  return { ok: true };
};

export const handleChatTogglePanel: BridgeHandlerFn = async ({ session }) => {
  const host = resolveHostWebContents(session.webContentsId);
  if (!host || host.isDestroyed()) {
    throw Object.assign(new Error('Host window unavailable'), { code: 'INTERNAL_ERROR' });
  }
  host.send('sclaw-browser:toggle-chat', { runtimeId: session.runtimeId ?? undefined });
  return { ok: true };
};
