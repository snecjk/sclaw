/**
 * Inject XHR patch into embed webview guests before page scripts (CDP).
 */
import type { WebContents } from 'electron';
import { SCLAW_EMBED_BROWSER_XHR_PATCH_SCRIPT } from '../../../shared/sclaw-embed-browser-xhr-patch';
import { logger } from '../../utils/logger';

const CDP_VERSION = '1.3';
const patchedWebContentsIds = new Set<number>();

async function registerXhrPatchViaCdp(wc: WebContents): Promise<boolean> {
  if (wc.isDestroyed()) return false;

  let attachedHere = false;
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach(CDP_VERSION);
      attachedHere = true;
    }
    await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: SCLAW_EMBED_BROWSER_XHR_PATCH_SCRIPT,
    });
    return true;
  } catch (error) {
    logger.warn('[SclawEmbedBrowser] CDP XHR patch registration failed:', error);
    return false;
  } finally {
    if (attachedHere && wc.debugger.isAttached()) {
      try {
        wc.debugger.detach();
      } catch {
        // best-effort — DevTools / automation may have taken over
      }
    }
  }
}

function applyXhrPatchFallback(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  void wc.executeJavaScript(SCLAW_EMBED_BROWSER_XHR_PATCH_SCRIPT, true).catch(() => {
    // navigation race — dom-ready retry below
  });
}

/**
 * Ensure embed guest patches forbidden XHR headers before page scripts on every navigation.
 *
 * CDP `Page.addScriptToEvaluateOnNewDocument` only covers documents created after
 * registration, so a fast first navigation can race past it — and SPA in-page
 * navigations never create a new document at all. The dom-ready executeJavaScript
 * pass therefore runs unconditionally; the injected script is idempotent
 * (`__STOCLAW_XHR_PATCHED__`), so double-patching is a no-op.
 */
export async function ensureSclawEmbedBrowserXhrPatch(wc: WebContents): Promise<void> {
  if (wc.isDestroyed() || patchedWebContentsIds.has(wc.id)) return;

  await registerXhrPatchViaCdp(wc);

  // Patch the current document and re-patch on every full navigation.
  applyXhrPatchFallback(wc);
  wc.on('dom-ready', () => applyXhrPatchFallback(wc));

  patchedWebContentsIds.add(wc.id);
  wc.once('destroyed', () => {
    patchedWebContentsIds.delete(wc.id);
  });
}
