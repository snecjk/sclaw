/**
 * Drawer content frame — Electron webview (first-party cookies) or dev iframe.
 */
import { useEffect, useRef } from 'react';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import { isStoPolicyHostUrl, markStoPolicyWebAuthedInSession } from '@/lib/sto-policy-web-url';
import { registerSclawBrowserWebview } from '@/lib/sclaw-browser-page-capture';
import {
  bindSclawBrowserWebContents,
  updateSclawBrowserPageState,
} from '@/lib/sclaw-browser-host-api';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';

const isElectron = Boolean(window.electron);

interface SclawBrowserFrameProps {
  url: string;
  title: string;
}

type EmbedWebviewElement = HTMLElement & {
  getURL?: () => string;
  getWebContentsId?: () => number;
  loadURL?: (url: string) => void;
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

export function SclawBrowserFrame({ url, title }: SclawBrowserFrameProps) {
  const webviewRef = useRef<EmbedWebviewElement>(null);
  const embedRuntimeId = useSclawBrowserOverlayStore((s) => s.embedRuntimeId);

  useEffect(() => {
    if (!isElectron || !embedRuntimeId) {
      registerSclawBrowserWebview(null);
      return;
    }

    const el = webviewRef.current;
    if (!el) return;

    let domReady = false;

    const bindAfterDomReady = () => {
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
      });
    };

    const onNavigate = () => {
      if (!domReady) return;
      const pageUrl = safeGetWebviewUrl(el, url);
      markPolicyAuthedFromUrl(pageUrl);
      void updateSclawBrowserPageState({ runtimeId: embedRuntimeId, pageUrl });
    };

    const onFinishLoad = () => {
      if (!domReady && safeGetWebContentsId(el)) {
        bindAfterDomReady();
      }
      onNavigate();
    };

    const onNewWindow = (event: Event) => {
      const detail = event as Event & { url?: string; preventDefault?: () => void };
      detail.preventDefault?.();
      if (!detail.url) return;
      // Keep navigation inside the built-in webview instead of opening system Chrome.
      if (typeof el.loadURL === 'function') {
        void el.loadURL(detail.url);
        return;
      }
      el.setAttribute('src', detail.url);
    };

    el.addEventListener('dom-ready', bindAfterDomReady);
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigate);
    el.addEventListener('did-finish-load', onFinishLoad);
    el.addEventListener('new-window', onNewWindow);

    // dom-ready may have fired before listeners attached (e.g. delayed frame mount).
    window.requestAnimationFrame(() => {
      if (!domReady && safeGetWebContentsId(el)) {
        bindAfterDomReady();
      }
    });

    return () => {
      domReady = false;
      registerSclawBrowserWebview(null);
      el.removeEventListener('dom-ready', bindAfterDomReady);
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigate);
      el.removeEventListener('did-finish-load', onFinishLoad);
      el.removeEventListener('new-window', onNewWindow);
    };
  }, [embedRuntimeId, url]);

  if (isElectron) {
    return (
      <webview
        ref={webviewRef as React.RefObject<HTMLElement>}
        src={url}
        partition={SCLAW_EMBED_BROWSER_PARTITION}
        allowpopups
        className="sclaw-browser-drawer__frame sclaw-browser-drawer__frame--webview"
      />
    );
  }

  return (
    <iframe
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
}
