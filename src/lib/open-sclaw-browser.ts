/**
 * Public API — open URLs in the SClaw in-app browser overlay (iframe).
 * Use instead of window.open / shell.openExternal when embedded browsing is desired.
 */
import { getWorkflowStoToken } from '@/lib/workflow-api';
import { openExternalUrl } from '@/lib/preview-url';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';

export interface OpenSclawBrowserOptions {
  url: string;
  title?: string;
}

/**
 * Replace `useStoToken=1` with `stotoken={local SSO token}` when present in the URL query.
 * Relative URLs are supported; other query params and hash are preserved.
 */
export function resolveSclawBrowserUrl(url: string): string {
  const trimmed = url?.trim();
  if (!trimmed) return trimmed;

  try {
    const isAbsolute = /^https?:\/\//i.test(trimmed);
    const parsed = new URL(trimmed, isAbsolute ? undefined : 'https://stoclaw.local');

    if (parsed.searchParams.get('useStoToken') !== '1') {
      return trimmed;
    }

    parsed.searchParams.delete('useStoToken');
    const token = getWorkflowStoToken();
    if (token) {
      parsed.searchParams.set('stotoken', token);
    }

    if (isAbsolute) {
      return parsed.toString();
    }

    const path = trimmed.split(/[?#]/, 1)[0] ?? parsed.pathname.replace(/^\//, '');
    return `${path}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}

/** Open a URL in the SClaw browser overlay. No-op when url is empty. */
export function openInSclawBrowser({ url, title }: OpenSclawBrowserOptions): void {
  const trimmed = url?.trim();
  if (!trimmed) return;
  const resolvedUrl = resolveSclawBrowserUrl(trimmed);
  useSclawBrowserOverlayStore.getState().open({
    url: resolvedUrl,
    title: title?.trim() || trimmed,
  });
}

/** Close the SClaw browser drawer immediately (no exit animation). */
export function closeSclawBrowser(): void {
  useSclawBrowserOverlayStore.getState().close();
}

/** Whether the drawer is currently open. */
export function isSclawBrowserOpen(): boolean {
  return useSclawBrowserOverlayStore.getState().session !== null;
}

/** Open the current overlay URL in the system default browser. */
export function openSclawBrowserInSystemBrowser(): void {
  const session = useSclawBrowserOverlayStore.getState().session;
  if (!session?.url) return;
  openExternalUrl(session.url);
}
