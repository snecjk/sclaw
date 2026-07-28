/**
 * Public API — open URLs in the App Plaza multi-tab browser (preferred)
 * or legacy single-session drawer when explicitly requested.
 */
import { toast } from 'sonner';
import {
  appendSkipLoginReturnUrl,
  fetchAppPlazaSkipLoginLink,
} from '@/lib/app-plaza-api';
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
  /** Original target URL before auth rewrites / ticket exchange. */
  sourceUrl?: string;
  /** Subsystem code used to exchange skip-login URLs. */
  systemCode?: string;
}

async function openUrlWithOptionalSkipLogin(opts: {
  url: string;
  sourceUrl?: string;
  systemCode?: string;
}): Promise<void> {
  const systemCode = opts.systemCode?.trim();
  // 空编码 / sto-policy：不换免登，直接外开（sto-policy 走页内二次登录 / useStoToken）。
  if (!systemCode || systemCode === 'sto-policy') {
    openExternalUrl(opts.url);
    return;
  }

  try {
    const skipLoginUrl = await fetchAppPlazaSkipLoginLink(systemCode);
    const targetUrl = appendSkipLoginReturnUrl(skipLoginUrl, opts.sourceUrl || opts.url);
    openExternalUrl(targetUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast.error(message || '免登链接获取失败');
    openExternalUrl(opts.url);
  }
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
  sourceUrl,
  systemCode,
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
    sourceUrl,
    systemCode,
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

/** Open a specific App Plaza tab URL in the system browser (per-tab systemCode). */
export async function openSclawBrowserTabInSystemBrowser(tab: {
  url: string;
  sourceUrl?: string;
  systemCode?: string;
}): Promise<void> {
  if (!tab.url?.trim()) return;
  await openUrlWithOptionalSkipLogin({
    url: tab.url,
    sourceUrl: tab.sourceUrl,
    systemCode: tab.systemCode,
  });
}

/** Open the active App Plaza tab (or legacy drawer) URL in the system browser. */
export async function openSclawBrowserInSystemBrowser(): Promise<void> {
  const shell = useAppPlazaShellStore.getState();
  const active = shell.browserTabs.find((t) => t.id === shell.activeTabId);
  if (active?.url) {
    // Per-tab isolation: always use this tab's own systemCode / sourceUrl.
    await openSclawBrowserTabInSystemBrowser(active);
    return;
  }

  const session = useSclawBrowserOverlayStore.getState().session;
  if (!session?.url) return;
  await openSclawBrowserTabInSystemBrowser(session);
}
