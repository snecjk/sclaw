/**
 * Prepare fetched remote HTML for in-app srcDoc preview.
 * Keeps fetch+srcDoc rendering (OSS attachment pages) while restoring API/download context.
 */

import { STO_APPEARANCE_MESSAGE_TYPE } from '@/components/theme/appearance-context';
import type { ResolvedAppearance } from '@/hooks/use-resolved-appearance';

export const HTML_PREVIEW_IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-forms allow-downloads';

/** Parent must respond within this window or the iframe fetch proxy rejects. */
export const PREVIEW_HTTP_FETCH_TIMEOUT_MS = 30_000;

export type PreviewAppearanceMode = 'adaptive' | 'fidelity';

export type PreviewThemeOptions = {
  appearance: ResolvedAppearance;
  mode: PreviewAppearanceMode;
};

export function documentBaseUrl(sourceUrl: string): string {
  try {
    return new URL('./', sourceUrl).href;
  } catch {
    return sourceUrl;
  }
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function buildPreviewThemeStyle(mode: PreviewAppearanceMode): string {
  const adaptiveStyles = mode === 'adaptive' ? `
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] body {
  color:var(--sto-preview-text) !important;
  background:var(--sto-preview-surface) !important;
}
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] :is(table, th, td) {
  color:var(--sto-preview-text) !important;
  border-color:var(--sto-preview-border) !important;
}
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] table,
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] th {
  background:var(--sto-preview-surface-elevated) !important;
}
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] td {
  background:var(--sto-preview-surface-secondary) !important;
}
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] :is(input, button) {
  color:var(--sto-preview-text) !important;
  background:var(--sto-preview-surface-secondary) !important;
  border-color:var(--sto-preview-border) !important;
}
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] :is(code, pre) {
  color:var(--sto-preview-text) !important;
  background:var(--sto-preview-surface-secondary) !important;
}
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] blockquote {
  color:var(--sto-preview-text-secondary) !important;
  border-color:var(--sto-preview-border) !important;
}` : '';

  return `<style data-sto-preview-theme>
html[data-sto-theme="light"] {
  color-scheme:light;
  --sto-preview-surface:#ffffff;
  --sto-preview-surface-secondary:#f8f8f8;
  --sto-preview-surface-elevated:#f2f3f5;
  --sto-preview-text:#1d2129;
  --sto-preview-text-secondary:#4e5969;
  --sto-preview-border:#e5e6eb;
}
html[data-sto-theme="dark"] {
  color-scheme:dark;
  --sto-preview-surface:#212121;
  --sto-preview-surface-secondary:#212121;
  --sto-preview-surface-elevated:#282828;
  --sto-preview-text:#dfdfdf;
  --sto-preview-text-secondary:rgba(255,255,255,.70);
  --sto-preview-border:rgba(255,255,255,.08);
}${adaptiveStyles}
</style>`;
}

function buildPreviewThemeScript(): string {
  const messageType = JSON.stringify(STO_APPEARANCE_MESSAGE_TYPE);
  return `<script data-sto-preview-theme>
(function () {
  var PARENT = window.parent;
  var MESSAGE_TYPE = ${messageType};
  if (!PARENT || PARENT === window) return;

  window.addEventListener('message', function (event) {
    if (event.source !== PARENT) return;
    var data = event.data;
    if (!data || data.type !== MESSAGE_TYPE) return;
    if (data.appearance !== 'light' && data.appearance !== 'dark') return;
    document.documentElement.dataset.stoTheme = data.appearance;
    document.documentElement.style.colorScheme = data.appearance;
  });
})();
</script>`;
}

function injectPreviewRootAttributes(
  html: string,
  { appearance, mode }: PreviewThemeOptions,
): string {
  const attributes = ` data-sto-theme="${escapeHtmlAttr(appearance)}" data-sto-preview-mode="${escapeHtmlAttr(mode)}"`;
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, (_match, existingAttributes: string) => {
      const cleanedAttributes = existingAttributes
        .replace(/\sdata-sto-theme(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '')
        .replace(/\sdata-sto-preview-mode(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
      return `<html${cleanedAttributes}${attributes}>`;
    });
  }
  return `<html${attributes}>${html}</html>`;
}

/** Add an initial appearance and a parent-window appearance bridge to inline HTML. */
export function injectSrcDocTheme(html: string, options: PreviewThemeOptions): string {
  const themedHtml = injectPreviewRootAttributes(html, options);
  const injection = `${buildPreviewThemeStyle(options.mode)}${buildPreviewThemeScript()}`;

  if (/<head[^>]*>/i.test(themedHtml)) {
    return themedHtml.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
  }
  return themedHtml.replace(/<html([^>]*)>/i, `<html$1><head>${injection}</head>`);
}

/** Prepare inline generated HTML without adding remote URL or fetch behavior. */
export function prepareInlinePreviewSrcDoc(html: string, options: PreviewThemeOptions): string {
  return injectSrcDocTheme(html, options);
}

export function injectSrcDocBaseHref(html: string, sourceUrl: string): string {
  if (/<base\s[\s\S]*?\bhref\s*=/i.test(html)) return html;

  const baseHref = escapeHtmlAttr(documentBaseUrl(sourceUrl));
  const baseTag = `<base href="${baseHref}">`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
  }
  return `<head>${baseTag}</head>${html}`;
}

function buildFetchBridgeScript(sourceOrigin: string): string {
  const originJson = JSON.stringify(sourceOrigin);
  const timeoutMs = PREVIEW_HTTP_FETCH_TIMEOUT_MS;
  return `<script>
(function () {
  var ARTIFACT_ORIGIN = ${originJson};
  var FETCH_TIMEOUT_MS = ${timeoutMs};
  var PARENT = window.parent;
  if (!PARENT || PARENT === window) return;

  function resolveUrl(input) {
    try { return new URL(input, document.baseURI).href; } catch (e) { return String(input); }
  }

  function shouldProxy(url) {
    try { return new URL(url).origin === ARTIFACT_ORIGIN; } catch (e) { return false; }
  }

  function headersToObject(headers) {
    if (!headers) return {};
    if (headers instanceof Headers) {
      var out = {};
      headers.forEach(function (value, key) { out[key] = value; });
      return out;
    }
    return headers;
  }

  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = resolveUrl(typeof input === 'string' ? input : (input && input.url ? input.url : String(input)));
    if (!shouldProxy(url)) return origFetch(input, init);

    var method = (init && init.method) || 'GET';
    var headers = headersToObject(init && init.headers);
    var body = init && init.body;

    return new Promise(function (resolve, reject) {
      var requestId = 'pf_' + Math.random().toString(36).slice(2);
      var settled = false;
      function finish(err, response) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (err) reject(err);
        else resolve(response);
      }
      function onMessage(event) {
        if (event.source !== PARENT) return;
        var data = event.data;
        if (!data || data.type !== 'preview-http-fetch-response' || data.requestId !== requestId) return;
        if (data.error) {
          finish(new Error(data.error));
          return;
        }
        var bytes = null;
        if (data.bodyBase64) {
          var raw = atob(data.bodyBase64);
          bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        }
        finish(null, new Response(bytes, {
          status: data.status || 200,
          headers: data.headers || {},
        }));
      }
      var timer = setTimeout(function () {
        finish(new Error('Preview fetch timed out'));
      }, FETCH_TIMEOUT_MS);
      window.addEventListener('message', onMessage);
      PARENT.postMessage({
        type: 'preview-http-fetch',
        requestId: requestId,
        url: url,
        method: method,
        headers: headers,
        body: typeof body === 'string' ? body : undefined,
      }, '*');
    });
  };
})();
</script>`;
}

export function injectSrcDocFetchBridge(html: string, sourceUrl: string): string {
  let origin = '';
  try {
    origin = new URL(sourceUrl).origin;
  } catch {
    return html;
  }
  if (!origin) return html;

  const script = buildFetchBridgeScript(origin);
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${script}</head>`);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${script}`);
  }
  return `${script}${html}`;
}

/** Inject appearance, base URL, and same-origin fetch behavior for interactive srcDoc previews. */
export function preparePreviewSrcDoc(
  html: string,
  sourceUrl: string,
  options: PreviewThemeOptions,
): string {
  const themedHtml = injectSrcDocTheme(html, options);
  return injectSrcDocFetchBridge(injectSrcDocBaseHref(themedHtml, sourceUrl), sourceUrl);
}

export type PreviewHttpFetchMessage = {
  type: 'preview-http-fetch';
  requestId: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export function isPreviewHttpFetchMessage(data: unknown): data is PreviewHttpFetchMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as PreviewHttpFetchMessage;
  return msg.type === 'preview-http-fetch'
    && typeof msg.requestId === 'string'
    && typeof msg.url === 'string';
}
