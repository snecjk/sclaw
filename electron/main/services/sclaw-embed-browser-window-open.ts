/**
 * Forward embed webview window.open / target=_blank into App Plaza tabs.
 *
 * Electron webview guests need setWindowOpenHandler on the guest WebContents
 * (not the embedder). Attach as early as web-contents-created so clicks work
 * even if renderer bind races registerRuntime.
 */
import { app, BrowserWindow, webContents, type WebContents } from 'electron';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import { resolveSclawEmbedWindowOpenAction } from '../../../shared/sclaw-embed-browser-window-open';

const runtimeByWebContentsId = new Map<number, string>();
const handlerAttachedIds = new Set<number>();
let hookInstalled = false;

function isEmbedBrowserWebview(wc: WebContents): boolean {
  try {
    if (wc.getType() !== 'webview') return false;
  } catch {
    return false;
  }
  try {
    const partition = wc.session?.partition ?? '';
    return (
      partition === SCLAW_EMBED_BROWSER_PARTITION
      || partition === SCLAW_EMBED_BROWSER_PARTITION.replace(/^persist:/, '')
      || partition.includes('sclaw-embedded-browser')
    );
  } catch {
    return false;
  }
}

function resolveHostWebContents(guest: WebContents): WebContents | null {
  const host = (guest as WebContents & { hostWebContents?: WebContents | null }).hostWebContents;
  if (host && !host.isDestroyed()) return host;

  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused.webContents;

  const candidate = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  return candidate?.webContents ?? null;
}

function notifyOpenUrl(url: string, runtimeId: string | null, guest: WebContents): void {
  const target = resolveHostWebContents(guest);
  if (!target || target.isDestroyed()) return;
  target.send('sclaw-browser:open-url', {
    url,
    runtimeId: runtimeId ?? undefined,
  });
}

function applyWindowOpenHandler(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  const webContentsId = wc.id;
  if (handlerAttachedIds.has(webContentsId)) return;

  wc.setWindowOpenHandler(({ url }) => {
    if (wc.isDestroyed()) return { action: 'deny' };
    const action = resolveSclawEmbedWindowOpenAction(url);
    if (action.kind === 'download') {
      try {
        wc.downloadURL(action.url);
      } catch {
        // best-effort
      }
      return { action: 'deny' };
    }
    if (action.kind === 'open-tab') {
      const runtimeId = runtimeByWebContentsId.get(webContentsId) ?? null;
      notifyOpenUrl(action.url, runtimeId, wc);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  handlerAttachedIds.add(webContentsId);
  wc.once('destroyed', () => {
    handlerAttachedIds.delete(webContentsId);
    runtimeByWebContentsId.delete(webContentsId);
  });
}

/** Install once: catch every embed webview as soon as it is created. */
export function installSclawEmbedBrowserWindowOpenHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;

  app.on('web-contents-created', (_event, wc) => {
    const tryAttach = () => {
      if (wc.isDestroyed()) return;
      if (!isEmbedBrowserWebview(wc)) return;
      applyWindowOpenHandler(wc);
    };

    // Type/partition are usually ready immediately; also retry on dom-ready.
    queue Promise.resolve().then(tryAttach);
    wc.once('dom-ready', tryAttach);
  });
}

export function attachSclawEmbedBrowserWindowOpenHandler(
  webContentsId: number,
  runtimeId: string,
): void {
  installSclawEmbedBrowserWindowOpenHook();

  runtimeByWebContentsId.set(webContentsId, runtimeId);

  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) return;
  // Force re-apply so a prior deny-only detach cannot stick.
  handlerAttachedIds.delete(webContentsId);
  applyWindowOpenHandler(wc);
}

export function detachSclawEmbedBrowserWindowOpenHandler(
  webContentsId: number | null | undefined,
): void {
  if (!webContentsId) return;
  runtimeByWebContentsId.delete(webContentsId);
  if (!handlerAttachedIds.has(webContentsId)) return;

  const wc = webContents.fromId(webContentsId);
  if (wc && !wc.isDestroyed()) {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
  handlerAttachedIds.delete(webContentsId);
}

export function detachAllSclawEmbedBrowserWindowOpenHandlers(): void {
  for (const webContentsId of [...handlerAttachedIds]) {
    detachSclawEmbedBrowserWindowOpenHandler(webContentsId);
  }
}
