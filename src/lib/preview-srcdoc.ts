/**
 * Prepare fetched remote HTML for in-app srcDoc preview.
 * Keeps fetch+srcDoc rendering (OSS attachment pages) while restoring API/download context.
 */

export const HTML_PREVIEW_IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-forms allow-downloads';

/** Parent must respond within this window or the iframe fetch proxy rejects. */
export const PREVIEW_HTTP_FETCH_TIMEOUT_MS = 30_000;

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

/** Inject base URL + same-origin fetch bridge for interactive srcDoc previews. */
export function preparePreviewSrcDoc(html: string, sourceUrl: string): string {
  return injectSrcDocFetchBridge(injectSrcDocBaseHref(html, sourceUrl), sourceUrl);
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
