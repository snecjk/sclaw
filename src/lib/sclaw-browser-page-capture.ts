/**
 * Capture visible page context from the embed browser webview (Electron) or iframe fallback.
 */
import type { SclawBrowserEmbedContextBlock } from '@/lib/sclaw-browser-embed-context';

const VISIBLE_TEXT_LIMIT = 6000;

const PAGE_CAPTURE_SCRIPT = `(function() {
  try {
    var title = document.title || '';
    var url = location.href || '';
    var clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) return { title: title, url: url, text: '' };
    var remove = clone.querySelectorAll('script,style,noscript,svg,iframe');
    for (var i = 0; i < remove.length; i++) remove[i].remove();
    var text = (clone.innerText || clone.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length > ${VISIBLE_TEXT_LIMIT}) {
      text = text.slice(0, ${VISIBLE_TEXT_LIMIT}) + '…';
    }
    return { title: title, url: url, text: text };
  } catch (err) {
    return { title: document.title || '', url: location.href || '', text: '' };
  }
})()`;

type EmbedWebviewElement = HTMLElement & {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  getURL?: () => string;
};

let registeredWebview: EmbedWebviewElement | null = null;

export function registerSclawBrowserWebview(element: EmbedWebviewElement | null): void {
  registeredWebview = element;
}

export async function captureSclawBrowserPageContext(input: {
  embedRuntimeId: string;
  bridgeSessionId: string;
  appTitle: string;
  url: string;
}): Promise<SclawBrowserEmbedContextBlock> {
  const capturedAt = Date.now();
  const base: SclawBrowserEmbedContextBlock = {
    embedRuntimeId: input.embedRuntimeId,
    bridgeSessionId: input.bridgeSessionId,
    appTitle: input.appTitle,
    pageUrl: input.url,
    pageTitle: '',
    visibleTextExcerpt: '',
    capturedAt,
  };

  const webview = registeredWebview;
  if (!webview?.executeJavaScript) {
    return base;
  }

  try {
    const result = await webview.executeJavaScript(PAGE_CAPTURE_SCRIPT) as {
      title?: string;
      url?: string;
      text?: string;
    } | null;

    const pageUrl = (typeof result?.url === 'string' && result.url.trim())
      ? result.url.trim()
      : (webview.getURL?.() ?? input.url);

    return {
      ...base,
      pageUrl,
      pageTitle: typeof result?.title === 'string' ? result.title.trim() : '',
      visibleTextExcerpt: typeof result?.text === 'string' ? result.text.trim() : '',
    };
  } catch {
    return {
      ...base,
      pageUrl: webview.getURL?.() ?? input.url,
    };
  }
}
