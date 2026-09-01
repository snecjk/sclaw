/**
 * Force embed webview guest preferences at creation time.
 *
 * Renderer setAttribute('webpreferences', …) runs after guest WebContents may
 * already exist — on Windows that leaves sandbox enabled and breaks
 * <input type="file"> multipart uploads (empty/corrupt file body).
 */
import { app, BrowserWindow, type WebContents, type WebPreferences } from 'electron';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import { getJsBridgeGuestPreloadPath } from '../../utils/jsbridge-guest-preload-path';

function isEmbedPartition(partition: string | undefined): boolean {
  if (!partition) return false;
  return (
    partition === SCLAW_EMBED_BROWSER_PARTITION
    || partition === SCLAW_EMBED_BROWSER_PARTITION.replace(/^persist:/, '')
    || partition.includes('sclaw-embedded-browser')
  );
}

function applyEmbedGuestPreferences(webPreferences: WebPreferences): void {
  webPreferences.contextIsolation = true;
  webPreferences.nodeIntegration = false;
  webPreferences.sandbox = false;
  webPreferences.enableRemoteModule = false;
  webPreferences.preload = getJsBridgeGuestPreloadPath();
}

function attachWillAttachWebviewHandler(webContents: WebContents): void {
  if (webContents.isDestroyed()) return;

  webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    if (!isEmbedPartition(params.partition)) return;
    applyEmbedGuestPreferences(webPreferences);
    // Chromium blocks guest window.open unless this attribute is present.
    // React boolean props on <webview> can omit it; force it at attach time.
    params.allowpopups = 'true';
  });
}

let hookInstalled = false;

/** Install once: configure every embed webview guest before it is created. */
export function installSclawEmbedBrowserGuestPreferencesHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;

  app.on('browser-window-created', (_event, window) => {
    attachWillAttachWebviewHandler(window.webContents);
  });

  for (const window of BrowserWindow.getAllWindows()) {
    attachWillAttachWebviewHandler(window.webContents);
  }
}
