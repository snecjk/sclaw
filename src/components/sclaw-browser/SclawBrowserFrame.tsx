/**
 * Drawer content frame — Electron webview (first-party cookies) or dev iframe.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import { isStoPolicyHostUrl, markStoPolicyWebAuthedInSession } from '@/lib/sto-policy-web-url';
import { registerSclawBrowserWebview } from '@/lib/sclaw-browser-page-capture';
import {
  bindSclawBrowserWebContents,
  updateSclawBrowserPageState,
} from '@/lib/sclaw-browser-host-api';
import { resolveSclawEmbedWindowOpenAction } from '../../../shared/sclaw-embed-browser-window-open';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { getJsBridgeGuestPreloadUrl } from '@/lib/jsbridge/host-api';
import {
  handleJsBridgeWebviewRequest,
  pushJsBridgeInit,
} from '@/lib/jsbridge/host-router';

const isElectron = Boolean(window.electron);

export interface SclawBrowserFrameHandle {
  goBack: () => void;
  reload: () => void;
  canGoBack: () => boolean;
}

interface SclawBrowserFrameProps {
  url: string;
  title: string;
  /** When set, binds this runtime instead of the overlay store value. */
  embedRuntimeId?: string | null;
  /** App Plaza app id for bridge trust policy. */
  appId?: string | null;
  /** Catalog / My Apps — elevated bridge trust tier. */
  bound?: boolean;
  /** When false, skip webview↔runtime bind (inactive live tab). Default true. */
  active?: boolean;
  /** Chrome-like: page-reported favicon URLs (first entry preferred). */
  onPageFavicon?: (faviconUrl: string) => void;
  /** Chrome-like: document title updates. */
  onPageTitle?: (title: string) => void;
  /** Chrome-like: live document URL after in-webview navigation. */
  onPageUrl?: (pageUrl: string) => void;
  /** Fired when history back availability changes. */
  onNavStateChange?: (state: { canGoBack: boolean }) => void;
  /** Optional lifecycle hook for embed debugging (navigation / load failures). */
  onWebviewLifecycle?: (event: SclawBrowserLifecycleEvent) => void;
  /**
   * Fallback for legacy webview `new-window` DOM events.
   * Prefer Main setWindowOpenHandler → sclaw-browser:open-url for Electron 40+.
   */
  onOpenWindow?: (url: string) => void;
}

export type SclawBrowserLifecycleType =
  | 'dom-ready'
  | 'did-start-loading'
  | 'did-stop-loading'
  | 'did-navigate'
  | 'did-navigate-in-page'
  | 'did-finish-load'
  | 'did-fail-load'
  | 'did-start-navigation'
  | 'page-title-updated';

export interface SclawBrowserLifecycleEvent {
  type: SclawBrowserLifecycleType;
  url?: string;
  title?: string;
  canGoBack?: boolean;
  errorCode?: number;
  errorDescription?: string;
  isMainFrame?: boolean;
}

type EmbedWebviewElement = HTMLElement & {
  getURL?: () => string;
  getWebContentsId?: () => number;
  loadURL?: (url: string) => void;
  goBack?: () => void;
  reload?: () => void;
  canGoBack?: () => boolean;
  send?: (channel: string, ...args: unknown[]) => void;
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
      appId: appIdProp,
      bound: boundProp,
      active = true,
      onPageFavicon,
      onPageTitle,
      onPageUrl,
      onNavStateChange,
      onOpenWindow,
      onWebviewLifecycle,
    },
    ref,
  ) {
    const webviewRef = useRef<EmbedWebviewElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const overlayRuntimeId = useSclawBrowserOverlayStore((s) => s.embedRuntimeId);
    const overlaySession = useSclawBrowserOverlayStore((s) => s.session);
    const embedRuntimeId = embedRuntimeIdProp !== undefined ? embedRuntimeIdProp : overlayRuntimeId;
    const appId = appIdProp ?? overlaySession?.appId ?? null;
    const bound = boundProp ?? Boolean(overlaySession?.appId);
    const [guestPreloadUrl, setGuestPreloadUrl] = useState<string | null>(null);
    const loadedUrlRef = useRef<string | null>(null);
    const onPageFaviconRef = useRef(onPageFavicon);
    const onPageTitleRef = useRef(onPageTitle);
    const onPageUrlRef = useRef(onPageUrl);
    const onNavStateChangeRef = useRef(onNavStateChange);
    const onOpenWindowRef = useRef(onOpenWindow);
    const onWebviewLifecycleRef = useRef(onWebviewLifecycle);
    onPageFaviconRef.current = onPageFavicon;
    onPageTitleRef.current = onPageTitle;
    onPageUrlRef.current = onPageUrl;
    onNavStateChangeRef.current = onNavStateChange;
    onOpenWindowRef.current = onOpenWindow;
    onWebviewLifecycleRef.current = onWebviewLifecycle;

    const emitWebviewLifecycle = (el: EmbedWebviewElement, event: SclawBrowserLifecycleEvent) => {
      onWebviewLifecycleRef.current?.({
        ...event,
        url: event.url ?? safeGetWebviewUrl(el, url),
        canGoBack: event.canGoBack ?? safeCanGoBack(el),
      });
    };

    useEffect(() => {
      if (!isElectron) return;
      void getJsBridgeGuestPreloadUrl().then((preloadUrl) => {
        if (preloadUrl) setGuestPreloadUrl(preloadUrl);
      });
    }, []);

    useEffect(() => {
      if (!isElectron || !guestPreloadUrl) return;
      const trimmed = url?.trim();
      if (!trimmed) return;
      const el = webviewRef.current;
      if (!el?.loadURL) return;
      if (loadedUrlRef.current === trimmed) return;
      loadedUrlRef.current = trimmed;
      el.loadURL(trimmed);
    }, [guestPreloadUrl, url]);

    useEffect(() => {
      if (!isElectron || !onWebviewLifecycleRef.current) return;
      const el = webviewRef.current;
      if (!el) return;

      const onDomReady = () => emitWebviewLifecycle(el, { type: 'dom-ready' });
      const onStartLoading = () => emitWebviewLifecycle(el, { type: 'did-start-loading' });
      const onStopLoading = () => emitWebviewLifecycle(el, { type: 'did-stop-loading' });
      const onNavigateDiag = () => emitWebviewLifecycle(el, { type: 'did-navigate' });
      const onNavigateInPageDiag = () => emitWebviewLifecycle(el, { type: 'did-navigate-in-page' });
      const onFinishLoadDiag = () => emitWebviewLifecycle(el, { type: 'did-finish-load' });
      const onStartNavigationDiag = () => emitWebviewLifecycle(el, { type: 'did-start-navigation' });
      const onFailLoad = (event: Event) => {
        const detail = event as Event & {
          errorCode?: number;
          errorDescription?: string;
          validatedURL?: string;
          isMainFrame?: boolean;
        };
        emitWebviewLifecycle(el, {
          type: 'did-fail-load',
          url: detail.validatedURL,
          errorCode: detail.errorCode,
          errorDescription: detail.errorDescription,
          isMainFrame: detail.isMainFrame,
        });
      };
      const onTitleUpdatedDiag = (event: Event) => {
        const detail = event as Event & { title?: string };
        if (typeof detail.title !== 'string' || !detail.title.trim()) return;
        emitWebviewLifecycle(el, {
          type: 'page-title-updated',
          title: detail.title.trim(),
        });
      };

      el.addEventListener('dom-ready', onDomReady);
      el.addEventListener('did-start-loading', onStartLoading);
      el.addEventListener('did-stop-loading', onStopLoading);
      el.addEventListener('did-navigate', onNavigateDiag);
      el.addEventListener('did-navigate-in-page', onNavigateInPageDiag);
      el.addEventListener('did-finish-load', onFinishLoadDiag);
      el.addEventListener('did-start-navigation', onStartNavigationDiag);
      el.addEventListener('did-fail-load', onFailLoad);
      el.addEventListener('page-title-updated', onTitleUpdatedDiag);

      return () => {
        el.removeEventListener('dom-ready', onDomReady);
        el.removeEventListener('did-start-loading', onStartLoading);
        el.removeEventListener('did-stop-loading', onStopLoading);
        el.removeEventListener('did-navigate', onNavigateDiag);
        el.removeEventListener('did-navigate-in-page', onNavigateInPageDiag);
        el.removeEventListener('did-finish-load', onFinishLoadDiag);
        el.removeEventListener('did-start-navigation', onStartNavigationDiag);
        el.removeEventListener('did-fail-load', onFailLoad);
        el.removeEventListener('page-title-updated', onTitleUpdatedDiag);
      };
    }, [guestPreloadUrl, url]);

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
        if (typeof el?.reload === 'function') {
          el.reload();
          return;
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
    }));

    useEffect(() => {
      if (!isElectron || !embedRuntimeId) {
        if (active) registerSclawBrowserWebview(null);
        return;
      }

      const el = webviewRef.current;
      if (!el) return;

      el.setAttribute('allowpopups', 'true');
      el.setAttribute(
        'webpreferences',
        'contextIsolation=yes,nodeIntegration=no,sandbox=no,enableRemoteModule=no',
      );
      if (guestPreloadUrl) {
        el.setAttribute('preload', guestPreloadUrl);
      }

      let domReady = false;

      const onIpcMessage = (event: Event) => {
        const detail = event as Event & { channel?: string; args?: unknown[] };
        if (detail.channel !== 'jsbridge:request') return;
        const envelope = detail.args?.[0];
        void handleJsBridgeWebviewRequest({ webview: el, envelope });
      };

      const bindAfterDomReady = () => {
        if (!active) return;
        const webContentsId = safeGetWebContentsId(el);
        if (!webContentsId) return;

        domReady = true;
        registerSclawBrowserWebview(el);

        const pageUrl = safeGetWebviewUrl(el, url);
        markPolicyAuthedFromUrl(pageUrl);
        void bindSclawBrowserWebContents({
          runtimeId: embedRuntimeId,
          webContentsId,
          pageUrl,
        }).then((result) => {
          if (result.meta?.bridgeBootstrap) {
            pushJsBridgeInit(el, result.meta.bridgeBootstrap);
          }
        });
        onPageUrlRef.current?.(pageUrl);
        publishNavState();
      };

      const onNavigate = () => {
        if (!active || !domReady) return;
        const pageUrl = safeGetWebviewUrl(el, url);
        markPolicyAuthedFromUrl(pageUrl);
        void updateSclawBrowserPageState({ runtimeId: embedRuntimeId, pageUrl });
        onPageUrlRef.current?.(pageUrl);
        publishNavState();
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
          onOpenWindowRef.current(rawUrl);
        }
      };

      const onFaviconUpdated = (event: Event) => {
        const detail = event as Event & { favicons?: string[] };
        const favicon = Array.isArray(detail.favicons) ? detail.favicons[0] : undefined;
        if (favicon) onPageFaviconRef.current?.(favicon);
      };

      const onTitleUpdated = (event: Event) => {
        const detail = event as Event & { title?: string };
        if (typeof detail.title === 'string' && detail.title.trim()) {
          onPageTitleRef.current?.(detail.title.trim());
        }
      };

      el.addEventListener('dom-ready', bindAfterDomReady);
      el.addEventListener('did-navigate', onNavigate);
      el.addEventListener('did-navigate-in-page', onNavigate);
      el.addEventListener('did-finish-load', onFinishLoad);
      el.addEventListener('did-start-navigation', publishNavState as EventListener);
      el.addEventListener('new-window', onNewWindow);
      el.addEventListener('page-favicon-updated', onFaviconUpdated);
      el.addEventListener('page-title-updated', onTitleUpdated);
      el.addEventListener('ipc-message', onIpcMessage);

      window.requestAnimationFrame(() => {
        if (active && !domReady && safeGetWebContentsId(el)) {
          bindAfterDomReady();
        }
      });

      return () => {
        domReady = false;
        if (active) registerSclawBrowserWebview(null);
        el.removeEventListener('dom-ready', bindAfterDomReady);
        el.removeEventListener('did-navigate', onNavigate);
        el.removeEventListener('did-navigate-in-page', onNavigate);
        el.removeEventListener('did-finish-load', onFinishLoad);
        el.removeEventListener('did-start-navigation', publishNavState as EventListener);
        el.removeEventListener('new-window', onNewWindow);
        el.removeEventListener('page-favicon-updated', onFaviconUpdated);
        el.removeEventListener('page-title-updated', onTitleUpdated);
        el.removeEventListener('ipc-message', onIpcMessage);
      };
    }, [embedRuntimeId, url, active, guestPreloadUrl, appId, bound]);

    if (isElectron) {
      return (
        <webview
          ref={webviewRef as React.RefObject<HTMLElement>}
          src="about:blank"
          partition={SCLAW_EMBED_BROWSER_PARTITION}
          allowpopups={true}
          webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=no,enableRemoteModule=no"
          preload={guestPreloadUrl ?? undefined}
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
