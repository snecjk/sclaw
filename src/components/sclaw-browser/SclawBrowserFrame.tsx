/**
 * Drawer content frame — Electron webview (first-party cookies) or dev iframe.
 *
 * Guest JSBridge preload must be attached before the first real navigation;
 * otherwise `window.stoClaw` is never injected.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import { isStoPolicyHostUrl, markStoPolicyWebAuthedInSession } from '@/lib/sto-policy-web-url';
import { registerSclawBrowserWebview } from '@/lib/sclaw-browser-page-capture';
import {
  bindSclawBrowserWebContents,
  updateSclawBrowserPageState,
} from '@/lib/sclaw-browser-host-api';
import {
  isSclawEmbedSameFrameWindowOpen,
  resolveSclawEmbedWindowOpenAction,
} from '../../../shared/sclaw-embed-browser-window-open';
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
  /**
   * Fallback for legacy webview `new-window` DOM events.
   * Prefer Main setWindowOpenHandler → sclaw-browser:open-url for Electron 40+.
   */
  onOpenWindow?: (url: string) => void;
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

/** Guest webviews always start at about:blank; skip-login tickets must not bind until a real page URL. */
function isEmbedWebviewPageUrl(pageUrl: string): boolean {
  if (!pageUrl || pageUrl === 'about:blank') return false;
  try {
    const protocol = new URL(pageUrl).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
  } catch {
    return false;
  }
}

async function bindEmbedWebContentsWithRetry(input: {
  runtimeId: string;
  webContentsId: number;
  pageUrl: string;
}): Promise<Awaited<ReturnType<typeof bindSclawBrowserWebContents>>> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await bindSclawBrowserWebContents(input);
    if (result.ok) return result;
    if (attempt < 7) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 40 * (attempt + 1));
      });
    }
  }
  return { ok: false };
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
    const [preloadReady, setPreloadReady] = useState(!isElectron);
    const launchedSrcRef = useRef<string | null>(null);
    /** True only after the guest webview has emitted dom-ready (required before loadURL). */
    const webviewDomReadyRef = useRef(false);
    const onPageFaviconRef = useRef(onPageFavicon);
    const onPageTitleRef = useRef(onPageTitle);
    const onPageUrlRef = useRef(onPageUrl);
    const onNavStateChangeRef = useRef(onNavStateChange);
    const onOpenWindowRef = useRef(onOpenWindow);
    onPageFaviconRef.current = onPageFavicon;
    onPageTitleRef.current = onPageTitle;
    onPageUrlRef.current = onPageUrl;
    onNavStateChangeRef.current = onNavStateChange;
    onOpenWindowRef.current = onOpenWindow;

    useEffect(() => {
      if (!isElectron) return;
      let cancelled = false;
      void getJsBridgeGuestPreloadUrl()
        .then((preloadUrl) => {
          if (cancelled) return;
          if (preloadUrl) setGuestPreloadUrl(preloadUrl);
          setPreloadReady(true);
        })
        .catch(() => {
          if (!cancelled) setPreloadReady(true);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    // Track dom-ready separately — getWebContentsId() can succeed before dom-ready,
    // but loadURL still throws until the event has fired.
    useEffect(() => {
      if (!isElectron || !preloadReady) {
        webviewDomReadyRef.current = false;
        return;
      }

      const el = webviewRef.current;
      if (!el) return;

      const onDomReady = () => {
        webviewDomReadyRef.current = true;
      };
      el.addEventListener('dom-ready', onDomReady);
      return () => {
        webviewDomReadyRef.current = false;
        el.removeEventListener('dom-ready', onDomReady);
      };
    }, [preloadReady]);

    // Navigate only after guest preload is attached AND webview has emitted dom-ready.
    // Calling loadURL before attach/dom-ready throws and crashes the App Plaza tree.
    useEffect(() => {
      if (!isElectron || !preloadReady) return;
      const el = webviewRef.current;
      if (!el || !url || launchedSrcRef.current === url) return;

      let cancelled = false;

      const navigate = () => {
        if (cancelled || !webviewDomReadyRef.current || launchedSrcRef.current === url) return;
        try {
          const result = el.loadURL?.(url);
          launchedSrcRef.current = url;
          void Promise.resolve(result).catch(() => {
            // SSO skip-login 302 aborts the original loadURL; the follow-up navigation still proceeds.
          });
        } catch {
          // Not attached / not dom-ready yet — wait for next dom-ready.
          launchedSrcRef.current = null;
        }
      };

      const onDomReady = () => {
        navigate();
      };

      if (webviewDomReadyRef.current) {
        navigate();
      } else {
        el.addEventListener('dom-ready', onDomReady);
      }

      return () => {
        cancelled = true;
        el.removeEventListener('dom-ready', onDomReady);
      };
    }, [preloadReady, url]);

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
      if (!isElectron || !preloadReady || !embedRuntimeId) {
        if (active) registerSclawBrowserWebview(null);
        return;
      }

      const el = webviewRef.current;
      if (!el) return;

      let boundToPage = false;

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

        const pageUrl = safeGetWebviewUrl(el, '');
        if (!isEmbedWebviewPageUrl(pageUrl)) return;

        boundToPage = true;
        registerSclawBrowserWebview(el);

        markPolicyAuthedFromUrl(pageUrl);
        void bindEmbedWebContentsWithRetry({
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
        if (!active) return;
        const pageUrl = safeGetWebviewUrl(el, '');
        if (!isEmbedWebviewPageUrl(pageUrl)) return;
        if (!boundToPage) {
          bindAfterDomReady();
          return;
        }
        markPolicyAuthedFromUrl(pageUrl);
        void updateSclawBrowserPageState({ runtimeId: embedRuntimeId, pageUrl });
        onPageUrlRef.current?.(pageUrl);
        publishNavState();
      };

      const onFinishLoad = () => {
        onNavigate();
      };

      const onNewWindow = (event: Event) => {
        const detail = event as Event & {
          url?: string;
          frameName?: string;
          preventDefault?: () => void;
        };
        const rawUrl = typeof detail.url === 'string' ? detail.url.trim() : '';
        if (!rawUrl) return;
        const action = resolveSclawEmbedWindowOpenAction(rawUrl);
        if (isSclawEmbedSameFrameWindowOpen(detail.frameName)) {
          detail.preventDefault?.();
          if (action.kind === 'open-tab') {
            try {
              void el.loadURL?.(action.url);
            } catch {
              // best-effort
            }
          }
          return;
        }
        detail.preventDefault?.();
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
        if (active && !boundToPage && safeGetWebContentsId(el)) {
          bindAfterDomReady();
        }
      });

      return () => {
        boundToPage = false;
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
    }, [embedRuntimeId, active, preloadReady, appId, bound]);

    if (isElectron) {
      if (!preloadReady) {
        return (
          <div className="sclaw-browser-drawer__frame sclaw-browser-drawer__frame--webview" />
        );
      }
      return (
        <webview
          ref={webviewRef as React.RefObject<HTMLElement>}
          src="about:blank"
          partition={SCLAW_EMBED_BROWSER_PARTITION}
          allowpopups={true}
          // @ts-expect-error Electron <webview> attributes
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
