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
  reportSclawBrowserVisibility,
  updateSclawBrowserPageState,
} from '@/lib/sclaw-browser-host-api';
import {
  isSclawEmbedSameFrameWindowOpen,
  resolveSclawEmbedWindowOpenAction,
} from '../../../shared/sclaw-embed-browser-window-open';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { PREVIEW_NETWORK_CAPTURE_SCRIPT } from '@/lib/app-dev-preview-console';
import { getJsBridgeGuestPreloadUrl } from '@/lib/jsbridge/host-api';
import {
  handleJsBridgeWebviewRequest,
  pushJsBridgeInit,
} from '@/lib/jsbridge/host-router';

const isElectron = Boolean(window.electron);

const EMBED_WEBVIEW_PREFERENCES =
  'contextIsolation=yes,nodeIntegration=no,sandbox=no,enableRemoteModule=no';

export interface SclawBrowserFrameHandle {
  goBack: () => void;
  reload: () => void;
  canGoBack: () => boolean;
  getURL: () => string;
  loadURL: (nextUrl: string) => void;
  /**
   * Execute JS in the guest page (Electron webview only).
   * Rejects in the iframe dev fallback or when the guest is not ready.
   */
  executeJS: (code: string) => Promise<unknown>;
  /** Guest WebContents id (Electron webview only); null in the iframe fallback. */
  getWebContentsId: () => number | null;
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
  reloadIgnoringCache?: () => void;
  canGoBack?: () => boolean;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
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

function safeLoadWebviewUrl(el: EmbedWebviewElement, nextUrl: string): boolean {
  const trimmed = nextUrl.trim();
  if (!trimmed) return false;
  try {
    if (typeof el.loadURL === 'function') {
      void Promise.resolve(el.loadURL(trimmed)).catch(() => undefined);
      return true;
    }
  } catch {
    // Guest not attached / dom-ready not emitted yet.
  }
  try {
    el.setAttribute('src', trimmed);
    return true;
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
      onWebviewLifecycle,
      onConsoleMessage,
      captureGuestNetworkFailures = false,
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
    const [automationActive, setAutomationActive] = useState(false);
    const launchedSrcRef = useRef<string | null>(null);
    const domReadyRef = useRef(false);
    const pendingUrlRef = useRef(url);
    const onPageFaviconRef = useRef(onPageFavicon);
    const onPageTitleRef = useRef(onPageTitle);
    const onPageUrlRef = useRef(onPageUrl);
    const onNavStateChangeRef = useRef(onNavStateChange);
    const onOpenWindowRef = useRef(onOpenWindow);
    const onWebviewLifecycleRef = useRef(onWebviewLifecycle);
    const onConsoleMessageRef = useRef(onConsoleMessage);
    const captureNetworkRef = useRef(captureGuestNetworkFailures);
    onPageFaviconRef.current = onPageFavicon;
    onPageTitleRef.current = onPageTitle;
    onPageUrlRef.current = onPageUrl;
    onNavStateChangeRef.current = onNavStateChange;
    onOpenWindowRef.current = onOpenWindow;
    onWebviewLifecycleRef.current = onWebviewLifecycle;
    onConsoleMessageRef.current = onConsoleMessage;
    captureNetworkRef.current = captureGuestNetworkFailures;
    pendingUrlRef.current = url;

    useEffect(() => {
      const api = window.electron?.ipcRenderer;
      if (!api?.on || !embedRuntimeId) return;
      const unsubscribe = api.on('sclaw-browser:automation-mark', (...args: unknown[]) => {
        const payload = args[0] as { runtimeId?: string; active?: boolean } | undefined;
        if (!payload || payload.runtimeId !== embedRuntimeId) return;
        setAutomationActive(payload.active === true);
      });
      return () => {
        unsubscribe?.();
        setAutomationActive(false);
      };
    }, [embedRuntimeId]);

    const emitWebviewLifecycle = (el: EmbedWebviewElement, event: SclawBrowserLifecycleEvent) => {
      onWebviewLifecycleRef.current?.({
        ...event,
        url: event.url ?? safeGetWebviewUrl(el, url),
        canGoBack: event.canGoBack ?? safeCanGoBack(el),
      });
    };

    const navigateGuest = (targetUrl: string, force = false): boolean => {
      const el = webviewRef.current;
      if (!el || !domReadyRef.current) return false;
      const trimmed = targetUrl.trim();
      if (!trimmed) return false;
      if (!force && launchedSrcRef.current === trimmed) return true;
      if (!safeLoadWebviewUrl(el, trimmed)) return false;
      launchedSrcRef.current = trimmed;
      return true;
    };

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
      if (!isElectron || !preloadReady) return;
      navigateGuest(url);
    }, [preloadReady, url]);

    // D1：BAP 可见性上报 —— active（tab 切换/drawer 显隐）变化与卸载时上报，
    // 主进程写入 runtime meta.visible 供 assertPageActionable 查询（B7）。
    useEffect(() => {
      if (!isElectron || !embedRuntimeId) return;
      void reportSclawBrowserVisibility(embedRuntimeId, active, 'tab-switch');
      return () => {
        void reportSclawBrowserVisibility(embedRuntimeId, false, 'tab-switch');
      };
    }, [embedRuntimeId, active]);

    useEffect(() => {
      if (!isElectron || !preloadReady || !onWebviewLifecycleRef.current) return;
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
        if (el) {
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
            if (safeLoadWebviewUrl(el, current)) return;
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
        if (navigateGuest(trimmed, true)) return;
        const el = webviewRef.current;
        if (el) {
          pendingUrlRef.current = trimmed;
          return;
        }
        const iframe = iframeRef.current;
        if (iframe) iframe.src = trimmed;
      },
      executeJS: (code: string) => {
        const el = webviewRef.current;
        if (!el || typeof el.executeJavaScript !== 'function') {
          return Promise.reject(new Error('executeJS 仅在 Electron 预览环境可用'));
        }
        return el.executeJavaScript(code);
      },
      getWebContentsId: () => {
        const el = webviewRef.current;
        if (!el) return null;
        return safeGetWebContentsId(el);
      },
    }));

    useEffect(() => {
      if (!isElectron || !preloadReady) {
        if (active) registerSclawBrowserWebview(null);
        return;
      }

      const el = webviewRef.current;
      if (!el) return;

      // Electron requires the allowpopups *attribute*; React booleans on <webview>
      // can omit it, which silently blocks guest window.open.
      el.setAttribute('allowpopups', 'true');

      if (active && !embedRuntimeId) registerSclawBrowserWebview(null);

      let boundToPage = false;

      const injectNetworkCapture = () => {
        if (!captureNetworkRef.current) return;
        void el.executeJavaScript?.(PREVIEW_NETWORK_CAPTURE_SCRIPT).catch(() => undefined);
      };

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
        injectNetworkCapture();
        registerSclawBrowserWebview(el);
        markPolicyAuthedFromUrl(pageUrl);
        onPageUrlRef.current?.(pageUrl);

        if (embedRuntimeId) {
          void bindEmbedWebContentsWithRetry({
            runtimeId: embedRuntimeId,
            webContentsId,
            pageUrl,
          }).then((result) => {
            if (result.meta?.bridgeBootstrap) {
              pushJsBridgeInit(el, result.meta.bridgeBootstrap);
            }
          });
        }

        publishNavState();
      };

      const onDomReady = () => {
        domReadyRef.current = true;
        navigateGuest(pendingUrlRef.current);
        bindAfterDomReady();
        // D1：dom-ready 后补一次可见性上报（覆盖挂载即 active 但 effect 早于绑定的时序）
        if (embedRuntimeId) {
          void reportSclawBrowserVisibility(embedRuntimeId, active, 'dom-ready');
        }
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
        onPageUrlRef.current?.(pageUrl);
        if (embedRuntimeId) {
          void updateSclawBrowserPageState({ runtimeId: embedRuntimeId, pageUrl });
        }
        publishNavState();
        injectNetworkCapture();
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
          onOpenWindowRef.current(action.url);
          return;
        }
        if (safeLoadWebviewUrl(el, action.url)) return;
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

      el.addEventListener('dom-ready', onDomReady);
      el.addEventListener('did-navigate', onNavigate);
      el.addEventListener('did-navigate-in-page', onNavigate);
      el.addEventListener('did-finish-load', onFinishLoad);
      el.addEventListener('did-start-navigation', publishNavState as EventListener);
      el.addEventListener('new-window', onNewWindow);
      el.addEventListener('page-favicon-updated', onFaviconUpdated);
      el.addEventListener('page-title-updated', onTitleUpdated);
      el.addEventListener('console-message', onConsoleMessage);
      el.addEventListener('ipc-message', onIpcMessage);

      window.requestAnimationFrame(() => {
        if (active && !boundToPage && safeGetWebContentsId(el)) {
          bindAfterDomReady();
        }
      });

      return () => {
        boundToPage = false;
        domReadyRef.current = false;
        launchedSrcRef.current = null;
        if (active) registerSclawBrowserWebview(null);
        el.removeEventListener('dom-ready', onDomReady);
        el.removeEventListener('did-navigate', onNavigate);
        el.removeEventListener('did-navigate-in-page', onNavigate);
        el.removeEventListener('did-finish-load', onFinishLoad);
        el.removeEventListener('did-start-navigation', publishNavState as EventListener);
        el.removeEventListener('new-window', onNewWindow);
        el.removeEventListener('page-favicon-updated', onFaviconUpdated);
        el.removeEventListener('page-title-updated', onTitleUpdated);
        el.removeEventListener('console-message', onConsoleMessage);
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
        <div className="sclaw-browser-drawer__frame-host relative min-h-0 flex-1">
          <webview
            ref={webviewRef as React.RefObject<HTMLElement>}
            src="about:blank"
            partition={SCLAW_EMBED_BROWSER_PARTITION}
            allowpopups="true"
            webpreferences={EMBED_WEBVIEW_PREFERENCES}
            preload={guestPreloadUrl ?? undefined}
            className="sclaw-browser-drawer__frame sclaw-browser-drawer__frame--webview"
          />
          {automationActive ? (
            <div className="sclaw-browser-drawer__automation-mark" aria-hidden="true">
              <span className="sclaw-browser-drawer__automation-badge">自动操作中</span>
            </div>
          ) : null}
        </div>
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
