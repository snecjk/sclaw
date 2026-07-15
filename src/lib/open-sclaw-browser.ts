/**
 * Public API — open URLs in the SClaw in-app browser overlay (iframe).
 * Use instead of window.open / shell.openExternal when embedded browsing is desired.
 */
import { getWorkflowStoToken } from '@/lib/workflow-api';
import { invokeIpc } from '@/lib/api-client';
import { openExternalUrl } from '@/lib/preview-url';
import { isStoEmbedBrowserUrl } from '../../shared/sclaw-embed-browser';
import {
  injectStoSsoWebAutoLogin,
  isStoSsoWebUrl,
  parseStoSsoWebUrl,
} from '@/lib/sto-policy-web-url';
import { deriveSclawBrowserAppId } from '@/lib/sclaw-browser-chat-session';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';

export interface OpenSclawBrowserOptions {
  url: string;
  title?: string;
  /** Stable app id — chat history is persisted per appId. */
  appId?: string;
}

/**
 * Resolve embed URL for the in-app browser drawer.
 * - sto-sso-web entry → inject autoLogin + token when available
 * - useStoToken=1 → strip flag and append stotoken (any host; config URL as-is otherwise)
 */
export function resolveSclawBrowserUrl(url: string): string {
  const trimmed = url?.trim();
  if (!trimmed) return trimmed;

  const token = getWorkflowStoToken();

  const ssoMeta = parseStoSsoWebUrl(trimmed);
  if (ssoMeta?.systemCode === 'sto-policy') {
    if (token) {
      return injectStoSsoWebAutoLogin(trimmed, token);
    }
    return trimmed;
  }

  if (token && isStoSsoWebUrl(trimmed)) {
    return injectStoSsoWebAutoLogin(trimmed, token);
  }

  try {
    const isAbsolute = /^https?:\/\//i.test(trimmed);
    const parsed = new URL(trimmed, isAbsolute ? undefined : 'https://stoclaw.local');

    if (parsed.searchParams.get('useStoToken') !== '1') {
      return trimmed;
    }

    parsed.searchParams.delete('useStoToken');

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

/** Open a URL in the SClaw browser drawer. No-op when url is empty. */
export function openInSclawBrowser({ url, title, appId }: OpenSclawBrowserOptions): void {
  const trimmed = url?.trim();
  if (!trimmed) return;
  const resolvedUrl = resolveSclawBrowserUrl(trimmed);
  const resolvedTitle = title?.trim() || trimmed;

  const resolvedAppId = deriveSclawBrowserAppId({ appId, url: resolvedUrl });

  const openDrawer = () => {
    useSclawBrowserOverlayStore.getState().open({
      appId: resolvedAppId,
      url: resolvedUrl,
      title: resolvedTitle,
    });
  };

  if (window.electron && isStoEmbedBrowserUrl(resolvedUrl)) {
    void invokeIpc('sclaw-browser:prepareSession', { url: resolvedUrl })
      .finally(openDrawer);
    return;
  }

  openDrawer();
}

/** Toggle ephemeral AI chat panel in the browser drawer. */
export function toggleSclawBrowserChat(): void {
  useSclawBrowserOverlayStore.getState().toggleChatPanel();
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
