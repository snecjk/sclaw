/**
 * Forward embed webview window.open / target=_blank into App Plaza tabs.
 *
 * Electron webview guests need setWindowOpenHandler on the guest WebContents
 * (not the embedder). Attach as early as web-contents-created so clicks work
 * even if renderer bind races registerRuntime.
 */
import { app, BrowserWindow, webContents, type WebContents } from 'electron';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import {
  isSclawEmbedDeferredWindowOpenUrl,
  isSclawEmbedHttpUrl,
  isSclawEmbedSameFrameWindowOpen,
  resolveSclawEmbedWindowOpenAction,
} from '../../../shared/sclaw-embed-browser-window-open';
import { ensureSclawEmbedBrowserXhrPatch } from './sclaw-embed-browser-xhr-patch';
import { logger } from '../../utils/logger';

const runtimeByWebContentsId = new Map<number, string>();
const handlerAttachedIds = new Set<number>();
const childWatchAttachedIds = new Set<number>();
const DEFERRED_CHILD_TIMEOUT_MS = 15_000;
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

function stealChildNavigation(parent: WebContents, child: BrowserWindow, navUrl: string): boolean {
  if (child.isDestroyed() || parent.isDestroyed()) return false;
  const action = resolveSclawEmbedWindowOpenAction(navUrl);
  if (action.kind === 'download') {
    try {
      parent.downloadURL(action.url);
    } catch {
      // best-effort
    }
    try {
      child.close();
    } catch {
      // best-effort
    }
    return true;
  }
  if (action.kind !== 'open-tab') return false;
  notifyOpenUrl(action.url, runtimeByWebContentsId.get(parent.id) ?? null, parent);
  try {
    child.close();
  } catch {
    // best-effort
  }
  return true;
}

/** Capture the real URL after window.open('') / about:blank, then fold it into a plaza tab. */
function watchDeferredChildWindow(parent: WebContents, child: BrowserWindow): void {
  if (child.isDestroyed() || parent.isDestroyed()) return;
  const childWc = child.webContents;
  let stolen = false;

  const steal = (navUrl: string) => {
    if (stolen) return;
    if (!isSclawEmbedHttpUrl(navUrl)) return;
    stolen = stealChildNavigation(parent, child, navUrl);
  };

  const onWillNavigate = (event: { preventDefault: () => void }, navUrl: string) => {
    if (!isSclawEmbedHttpUrl(navUrl)) return;
    event.preventDefault();
    steal(navUrl);
  };

  childWc.on('will-navigate', onWillNavigate);
  childWc.on('will-redirect', onWillNavigate);
  childWc.on('did-navigate', (_event, navUrl) => steal(navUrl));
  childWc.on('did-navigate-in-page', (_event, navUrl) => steal(navUrl));
  childWc.on('did-finish-load', () => {
    try {
      steal(childWc.getURL());
    } catch {
      // best-effort
    }
  });

  setTimeout(() => {
    if (stolen || child.isDestroyed()) return;
    try {
      child.close();
    } catch {
      // best-effort
    }
  }, DEFERRED_CHILD_TIMEOUT_MS);
}

function deferredWindowOpenAllow() {
  return {
    action: 'allow' as const,
    overrideBrowserWindowOptions: {
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        partition: SCLAW_EMBED_BROWSER_PARTITION,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
  };
}

function applyWindowOpenHandler(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  const webContentsId = wc.id;
  const alreadyAttached = handlerAttachedIds.has(webContentsId);

  void ensureSclawEmbedBrowserXhrPatch(wc);

  wc.setWindowOpenHandler(({ url, frameName }) => {
    if (wc.isDestroyed()) return { action: 'deny' };
    const action = resolveSclawEmbedWindowOpenAction(url);
    if (isSclawEmbedSameFrameWindowOpen(frameName)) {
      if (action.kind === 'download') {
        try {
          wc.downloadURL(action.url);
        } catch {
          // best-effort
        }
        return { action: 'deny' };
      }
      if (action.kind === 'open-tab') {
        try {
          void wc.loadURL(action.url);
        } catch {
          // best-effort
        }
      }
      return { action: 'deny' };
    }
    if (action.kind === 'download') {
      try {
        wc.downloadURL(action.url);
      } catch {
        // best-effort
      }
      return { action: 'deny' };
    }
    if (action.kind === 'open-tab') {
      notifyOpenUrl(action.url, runtimeByWebContentsId.get(webContentsId) ?? null, wc);
      return { action: 'deny' };
    }
    if (isSclawEmbedDeferredWindowOpenUrl(url)) {
      return deferredWindowOpenAllow();
    }
    return { action: 'deny' };
  });

  handlerAttachedIds.add(webContentsId);

  if (!childWatchAttachedIds.has(webContentsId)) {
    childWatchAttachedIds.add(webContentsId);
    wc.on('did-create-window', (child) => {
      watchDeferredChildWindow(wc, child);
    });
  }

  if (!alreadyAttached) {
    logger.info(`[SclawEmbedBrowser] window-open handler attached wc=${webContentsId}`);
    wc.once('destroyed', () => {
      handlerAttachedIds.delete(webContentsId);
      childWatchAttachedIds.delete(webContentsId);
      runtimeByWebContentsId.delete(webContentsId);
    });
  }
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

    // Must attach synchronously — a microtask can miss the first window.open.
    tryAttach();
    wc.once('did-start-loading', tryAttach);
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
  applyWindowOpenHandler(wc);
}

export function detachSclawEmbedBrowserWindowOpenHandler(
  webContentsId: number | null | undefined,
): void {
  if (!webContentsId) return;
  runtimeByWebContentsId.delete(webContentsId);
  // Keep the forwarding handler on a still-alive guest. Replacing it with
  // deny-all races remounts and silently drops window.open.
}

export function detachAllSclawEmbedBrowserWindowOpenHandlers(): void {
  runtimeByWebContentsId.clear();
}
