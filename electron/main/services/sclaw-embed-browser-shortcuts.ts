/**
 * Forward embed webview keyboard shortcuts to the main renderer (guest webview steals focus).
 */
import { BrowserWindow, webContents, type WebContents } from 'electron';
import { isSclawBrowserEmbedChatShortcut } from '../../../shared/sclaw-embed-browser-shortcut';

type BeforeInputHandler = (event: Electron.Event, input: Electron.Input) => void;

const handlers = new Map<number, BeforeInputHandler>();

function resolveMainWindowWebContents(): WebContents | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused.webContents;
  }
  const candidate = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  return candidate?.webContents ?? null;
}

function notifyToggleEmbedChat(): void {
  const target = resolveMainWindowWebContents();
  target?.send('sclaw-browser:toggle-chat');
}

export function attachSclawEmbedBrowserShortcutHandler(webContentsId: number): void {
  detachSclawEmbedBrowserShortcutHandler(webContentsId);

  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) return;

  const handler: BeforeInputHandler = (event, input) => {
    if (!isSclawBrowserEmbedChatShortcut(input, process.platform)) return;
    event.preventDefault();
    notifyToggleEmbedChat();
  };

  wc.on('before-input-event', handler);
  handlers.set(webContentsId, handler);
}

export function detachSclawEmbedBrowserShortcutHandler(webContentsId: number | null | undefined): void {
  if (!webContentsId) return;
  const handler = handlers.get(webContentsId);
  if (!handler) return;

  const wc = webContents.fromId(webContentsId);
  if (wc && !wc.isDestroyed()) {
    wc.removeListener('before-input-event', handler);
  }
  handlers.delete(webContentsId);
}

export function detachAllSclawEmbedBrowserShortcutHandlers(): void {
  for (const webContentsId of [...handlers.keys()]) {
    detachSclawEmbedBrowserShortcutHandler(webContentsId);
  }
}
