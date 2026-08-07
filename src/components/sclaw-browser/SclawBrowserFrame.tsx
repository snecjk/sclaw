/**
 * Drawer content frame — Electron webview (first-party cookies) or dev iframe.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import { isStoPolicyHostUrl, markStoPolicyWebAuthedInSession } from '@/lib/sto-policy-web-url';
import { registerSclawBrowserWebview } from '@/lib/sclaw-browser-page-capture';
import {
  bindSclawBrowserWebContents,
  updateSclawBrowserPageState,
} from '@/lib/sclaw-browser-host-api';
import { resolveSclawEmbedWindowOpenAction } from '../../../shared/sclaw-embed-browser-window-open';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { PREVIEW_NETWORK_CAPTURE_SCRIPT } from '@/lib/app-dev-preview-console';

const isElectron = Boolean(window.electron);

export interface SclawBrowserFrameHandle {
  goBack: () => void;
  reload: () => void;
  canGoBack: () => boolean;
  getURL: () => string;
  loadURL: (nextUrl: string) => void;
}

interface SclawBrowserFrameProps {
  url: string;
  title: string;
  /** When set, binds this runtime instead of the overlay store value. */
  embedRuntimeId?: string | null;
  /** When false, skip webview↔runtime bind (inactive live tab). Default true. */
  active?: boolean;
  /** Chrome-like: page-reported favicon URLs (first entry preferred). */
  onPageFavicon?: (faviconUrl: string) => void;
  /** Chrome-like: document title updates. */
  onPageTitle?: (title: string) => void;
  /** Fired when the frame URL changes (navigate / in-page). */
  onPageUrl?: (pageUrl: string) => void;
  /** Fired when history back availability changes. */
  onNavStateChange?: (state: { canGoBack: boolean }) => void;
  /**
   * Fallback for legacy webview `new-window` DOM events.
   * Prefer Main setWindowOpenHandler → sclaw-browser:open-url for Electron 40+.
   */
  onOpenWindow?: (url: string) => void;
  /**
   * Guest console lines (Electron webview). Host should filter before surfacing.
   */
  onConsoleMessage?: (info: { level: number; message: string; sourceId?: string; line?: number }) => void;
  /**
   * When set, inject a silent fetch hook so network failures always reach
   * console-message (page UI often swallows them; no Claw console module needed).
   */
  captureGuestNetworkFailures?: boolean;
}

type EmbedWebviewElement = HTMLElement & {
  getURL?: () => string;
  getWebContentsId?: () => number;
  loadURL?: (url: string) => void;
  goBack?: () => void;
  reload?: () => void;
  reloadIgnoringCache?: () => void;
  canGoBack?: () => boolean;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
};

function markPolicyAuthedFromUrl(frameUrl: string): void {
  if (isStoPolicyHostUrl(frameUrl) && !frameUrl.includes('/sso/login/callback')) {
    markStoPolicyWebAuthedInSession();
  }
}

function safeGetWebContentsId(el: EmbedWebviewElement): number | null {
  try {
    const id = el.getWebContentsId?.();
    return typeof id === 'number' && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function safeGetWebviewUrl(el: EmbedWebviewElement, fallback: string): string {
  try {
    return el.getURL?.() ?? fallback;
  } catch {
    return fallback;
  }
}

function safeCanGoBack(el: EmbedWebviewElement | null): boolean {
  try {
    return Boolean(el?.canGoBack?.());
  } catch {
    return false;
  }
}

export const SclawBrowserFrame = forwardRef<SclawBrowserFrameHandle, SclawBrowserFrameProps>(
  function SclawBrowserFrame(
    {
      url,
      title,
      embedRuntimeId: embedRuntimeIdProp,
      active = true,
      onPageFavicon,
      onPageTitle,
      onPageUrl,
      onNavStateChange,
      onOpenWindow,
      onConsoleMessage,
      captureGuestNetworkFailures = false,
    },
    ref,
  ) {
    const webviewRef = useRef<EmbedWebviewElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const overlayRuntimeId = useSclawBrowserOverlayStore((s) => s.embedRuntimeId);
    const embedRuntimeId = embedRuntimeIdProp !== undefined ? embedRuntimeIdProp : overlayRuntimeId;
    const onPageFaviconRef = useRef(onPageFavicon);
    const onPageTitleRef = useRef(onPageTitle);
    const onPageUrlRef = useRef(onPageUrl);
    const onNavStateChangeRef = useRef(onNavStateChange);
    const onOpenWindowRef = useRef(onOpenWindow);
    const onConsoleMessageRef = useRef(onConsoleMessage);
    const captureNetworkRef = useRef(captureGuestNetworkFailures);
    onPageFaviconRef.current = onPageFavicon;
    onPageTitleRef.current = onPageTitle;
    onPageUrlRef.current = onPageUrl;
    onNavStateChangeRef.current = onNavStateChange;
    onOpenWindowRef.current = onOpenWindow;
    onConsoleMessageRef.current = onConsoleMessage;
    captureNetworkRef.current = captureGuestNetworkFailures;

    const publishNavState = () => {
      const canGoBack = safeCanGoBack(webviewRef.current);
      onNavStateChangeRef.current?.({ canGoBack });
    };

    useImperativeHandle(ref, () => ({
      goBack: () => {
        const el = webviewRef.current;
        if (el?.canGoBack?.()) {
          el.goBack?.();
          return;
        }
        try {
          iframeRef.current?.contentWindow?.history.back();
        } catch {
          // cross-origin
        }
      },
      reload: () => {
        const el = webviewRef.current;
        if (el) {
          // Prefer a cache-bypassing reload so Vite-served SPAs actually refetch.
          try {
            if (typeof el.reloadIgnoringCache === 'function') {
              el.reloadIgnoringCache();
              return;
            }
          } catch {
            // Guest may not be ready; fall through.
          }
          try {
            if (typeof el.reload === 'function') {
              el.reload();
              return;
            }
          } catch {
            // Fall through to loadURL.
          }
          try {
            const current = safeGetWebviewUrl(el, url);
            if (typeof el.loadURL === 'function') {
              void el.loadURL(current);
              return;
            }
            el.setAttribute('src', current);
            return;
          } catch {
            // Fall through to iframe path.
          }
        }
        const iframe = iframeRef.current;
        if (iframe) {
          try {
            iframe.contentWindow?.location.reload();
          } catch {
iframe.setAttribute('src', iframe.src);
          }
        }
      },
      canGoBack: () => safeCanGoBack(webviewRef.current),
      getURL: () => {
        const el = webviewRef.current;
        if (el) return safeGetWebviewUrl(el, url);
        try {
          return iframeRef.current?.contentWindow?.location.href ?? url;
        } catch {
          return url;
        }
      },
      loadURL: (nextUrl: string) => {
        const trimmed = nextUrl.trim();
        if (!trimmed) return;
        const el = webviewRef.current;
        if (typeof el?.loadURL === 'function') {
          void el.loadURL(trimmed);
          return;
        }
        if (el) {
          el.setAttribute('src', trimmed);
          return;
        }
        const iframe = iframeRef.current;
        if (iframe) iframe.src = trimmed;
      },
    }));

    useEffect(() => {
      if (!isElectron) {
        if (active) registerSclawBrowserWebview(null);
        return;
      }

      const el = webviewRef.current;
      if (!el) return;

      // Navigation events stay bound without a runtime so plain preview frames
      // still report their URL and history state to the host toolbar.
      if (active && !embedRuntimeId) registerSclawBrowserWebview(null);

      // Electron requires the allowpopups *attribute*; React booleans can miss it.
      el.setAttribute('allowpopups', 'true');

      let domReady = false;

      const injectNetworkCapture = () => {
        if (!captureNetworkRef.current) return;
        void el.executeJavaScript?.(PREVIEW_NETWORK_CAPTURE_SCRIPT).catch(() => undefined);
      };

      const bindAfterDomReady = () => {
        if (!active) return;
        const webContentsId = safeGetWebContentsId(el);
        if (!webContentsId) return;

        domReady = true;
        injectNetworkCapture();

        const pageUrl = safeGetWebviewUrl(el, url);
        markPolicyAuthedFromUrl(pageUrl);
        onPageUrlRef.current?.(pageUrl);
        if (embedRuntimeId) {
          registerSclawBrowserWebview(el);
          void bindSclawBrowserWebContents({
            runtimeId: embedRuntimeId,
            webContentsId,
            pageUrl,
          });
        }
        publishNavState();
      };

      const onNavigate = () => {
        if (!active || !domReady) return;
        const pageUrl = safeGetWebviewUrl(el, url);
        markPolicyAuthedFromUrl(pageUrl);
        onPageUrlRef.current?.(pageUrl);
        if (embedRuntimeId) {
          void updateSclawBrowserPageState({ runtimeId: embedRuntimeId, pageUrl });
        }
        publishNavState();
        injectNetworkCapture();
      };

      const onFinishLoad = () => {
        if (!domReady && active && safeGetWebContentsId(el)) {
          bindAfterDomReady();
        }
        onNavigate();
      };

      const onNewWindow = (event: Event) => {
        const detail = event as Event & { url?: string; preventDefault?: () => void };
        detail.preventDefault?.();
        const rawUrl = typeof detail.url === 'string' ? detail.url.trim() : '';
        if (!rawUrl) return;
        const action = resolveSclawEmbedWindowOpenAction(rawUrl);
        if (action.kind !== 'open-tab') return;
        if (onOpenWindowRef.current) {
          onOpenWindowRef.current(action.url);
          return;
        }
        // No host callback — stay in-frame as last resort.
        if (typeof el.loadURL === 'function') {
          void el.loadURL(action.url);
          return;
        }
        el.setAttribute('src', action.url);
      };

      const onFaviconUpdated = (event: Event) => {
        const favicons = (event as Event & { favicons?: string[] }).favicons;
        const first = favicons?.find((item) => typeof item === 'string' && item.trim());
        if (first) onPageFaviconRef.current?.(first.trim());
      };

      const onTitleUpdated = (event: Event) => {
        const nextTitle = (event as Event & { title?: string }).title?.trim();
        if (nextTitle) onPageTitleRef.current?.(nextTitle);
      };

      const onConsoleMessage = (event: Event) => {
        const detail = event as Event & {
          level?: number;
          message?: string;
          sourceId?: string;
          line?: number;
        };
        const message = typeof detail.message === 'string' ? detail.message : '';
        if (!message.trim()) return;
        onConsoleMessageRef.current?.({
          level: typeof detail.level === 'number' ? detail.level : 3,
          message,
          sourceId: typeof detail.sourceId === 'string' ? detail.sourceId : undefined,
          line: typeof detail.line === 'number' ? detail.line : undefined,
        });
      };

      el.addEventListener('dom-ready', bindAfterDomReady);
      el.addEventListener('did-navigate', onNavigate);
      el.addEventListener('did-navigate-in-page', onNavigate);
      el.addEventListener('did-finish-load', onFinishLoad);
      el.addEventListener('did-start-navigation', publishNavState as EventListener);
      el.addEventListener('new-window', onNewWindow);
      el.addEventListener('page-favicon-updated', onFaviconUpdated);
      el.addEventListener('page-title-updated', onTitleUpdated);
      el.addEventListener('console-message', onConsoleMessage);

      window.requestAnimationFrame(() => {
        if (active && !domReady && safeGetWebContentsId(el)) {
          bindAfterDomReady();
        }
      });

      return () => {
        domReady = false;
        if (active && embedRuntimeId) registerSclawBrowserWebview(null);
        el.removeEventListener('dom-ready', bindAfterDomReady);
        el.removeEventListener('did-navigate', onNavigate);
        el.removeEventListener('did-navigate-in-page', onNavigate);
        el.removeEventListener('did-finish-load', onFinishLoad);
        el.removeEventListener('did-start-navigation', publishNavState as EventListener);
        el.removeEventListener('new-window', onNewWindow);
        el.removeEventListener('page-favicon-updated', onFaviconUpdated);
        el.removeEventListener('page-title-updated', onTitleUpdated);
        el.removeEventListener('console-message', onConsoleMessage);
      };
    }, [embedRuntimeId, url, active]);

    if (isElectron) {
      return (
        <webview
          ref={webviewRef as React.RefObject<HTMLElement>}
          src={url}
          partition={SCLAW_EMBED_BROWSER_PARTITION}
          allowpopups={true}
          className="sclaw-browser-drawer__frame sclaw-browser-drawer__frame--webview"
        />
      );
    }

    return (
      <iframe
        ref={iframeRef}
        src={url}
        title={title}
        className="sclaw-browser-drawer__frame"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        referrerPolicy="no-referrer"
        onLoad={(event) => {
          markPolicyAuthedFromUrl((event.currentTarget as HTMLIFrameElement).src);
        }}
      />
    );
  },
);
