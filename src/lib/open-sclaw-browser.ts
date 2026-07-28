/**
 * Public API — open URLs in the App Plaza multi-tab browser (preferred)
 * or legacy single-session drawer when explicitly requested.
 */
import { openExternalUrl } from '@/lib/preview-url';
import { appNavigate } from '@/lib/app-navigate';
import { resolveSclawBrowserUrl } from '@/lib/resolve-sclaw-browser-url';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import type { AppTone } from '@/types/more-apps';

export { resolveSclawBrowserUrl } from '@/lib/resolve-sclaw-browser-url';

export interface OpenSclawBrowserOptions {
  url: string;
  title?: string;
  /** Stable app id — chat history is persisted per appId. */
  appId?: string;
  /** When true, treat as catalog/My Apps (retain chat on tab close). Default: Boolean(appId). */
  bound?: boolean;
  iconUrl?: string;
  iconKey?: string;
  tone?: AppTone;
}

/** Open a URL in the App Plaza multi-tab shell. No-op when url is empty. */
export function openInSclawBrowser({
  url,
  title,
  appId,
  bound,
  iconUrl,
  iconKey,
  tone,
}: OpenSclawBrowserOptions): void {
  const trimmed = url?.trim();
  if (!trimmed) return;

  useAppPlazaShellStore.getState().openOrFocusBrowserTab({
    url: trimmed,
    title,
    appId,
    bound: bound ?? Boolean(appId?.trim()),
    iconUrl,
    iconKey,
    tone,
  });

  if (!useAppPlazaShellStore.getState().routeActive) {
    appNavigate('/more-apps');
  }
}

/** Toggle AI chat on the active App Plaza browser tab (falls back to legacy drawer). */
export function toggleSclawBrowserChat(): void {
  const shell = useAppPlazaShellStore.getState();
  const active = shell.browserTabs.find((t) => t.id === shell.activeTabId);
  if (active && active.status === 'live') {
    shell.toggleChatPanel(active.id);
    return;
  }
  useSclawBrowserOverlayStore.getState().toggleChatPanel();
}

/** Close the legacy drawer only (App Plaza tabs are closed individually). */
export function closeSclawBrowser(): void {
  useSclawBrowserOverlayStore.getState().close();
}

/** Whether the legacy drawer is open. */
export function isSclawBrowserOpen(): boolean {
  return useSclawBrowserOverlayStore.getState().session !== null;
}

/** Open the active App Plaza tab (or legacy drawer) URL in the system browser. */
export function openSclawBrowserInSystemBrowser(): void {
  const shell = useAppPlazaShellStore.getState();
  const active = shell.browserTabs.find((t) => t.id === shell.activeTabId);
  if (active?.url) {
    openExternalUrl(active.url);
    return;
  }
  const session = useSclawBrowserOverlayStore.getState().session;
  if (!session?.url) return;
  openExternalUrl(session.url);
}
