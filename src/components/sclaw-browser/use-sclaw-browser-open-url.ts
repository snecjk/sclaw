/**
 * Main → Renderer: embed webview window.open / target=_blank → App Plaza tab.
 */
import { useEffect } from 'react';
import { openInSclawBrowser } from '@/lib/open-sclaw-browser';
import { resolveSclawEmbedWindowOpenAction } from '../../../shared/sclaw-embed-browser-window-open';

function readOpenUrlPayload(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const action = resolveSclawEmbedWindowOpenAction(payload);
    return action.kind === 'open-tab' ? action.url : null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const url = (payload as { url?: unknown }).url;
  if (typeof url !== 'string') return null;
  const action = resolveSclawEmbedWindowOpenAction(url);
  return action.kind === 'open-tab' ? action.url : null;
}

/** Subscribe once at shell host so guest window.open opens plaza tabs. */
export function useSclawBrowserOpenUrl(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    if (!window.electron?.ipcRenderer?.on) return;

    const unsubscribe = window.electron.ipcRenderer.on(
      'sclaw-browser:open-url',
      (...args: unknown[]) => {
        const url = readOpenUrlPayload(args[0]);
        if (!url) return;
        openInSclawBrowser({ url });
      },
    );

    return () => {
      unsubscribe?.();
    };
  }, [enabled]);
}
