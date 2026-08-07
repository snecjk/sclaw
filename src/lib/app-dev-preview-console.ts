/**
 * Capture preview failures that never show in the page UI (only DevTools console /
 * failed fetch). No console panel in Claw — host listens and offers "交给 AI".
 */

const NOISE_PATTERNS = [
  /\[antd[:\]]/i,
  /favicon\.ico/i,
  /\[vite\]/i,
  /Download the React DevTools/i,
  /React Router Future Flag/i,
  /third-party cookie/i,
];

/** Prefixed logs from guest hooks / request wrapper — always actionable. */
const CAPTURE_PREFIXES = [
  /\[sclaw-preview-network\]/i,
  /\[sclaw-app-request\]/i,
];

const NETWORK_SIGNAL_PATTERNS = [
  /blocked by CORS/i,
  /Access to fetch/i,
  /Access-Control-Allow-Origin/i,
  /net::ERR_/i,
  /Failed to fetch/i,
  /ERR_FAILED/i,
  /NetworkError/i,
  /Load failed/i,
];

const ABSOLUTE_URL_RE = /https?:\/\/[^\s"'<>]+/i;

export function isHiddenPreviewFailureMessage(message: string): boolean {
  const text = message?.trim() ?? '';
  if (!text) return false;
  if (NOISE_PATTERNS.some((re) => re.test(text))) return false;
  if (CAPTURE_PREFIXES.some((re) => re.test(text))) return true;
  return NETWORK_SIGNAL_PATTERNS.some((re) => re.test(text));
}

/** @deprecated */
export function isApiFailureConsoleMessage(message: string): boolean {
  return isHiddenPreviewFailureMessage(message);
}

export function extractAbsoluteApiUrl(message: string): string | undefined {
  const match = message.match(ABSOLUTE_URL_RE);
  if (!match?.[0]) return undefined;
  return match[0].replace(/[.,;)]+$/, '');
}

/**
 * Build chat seed text: raw failure + page context for the agent.
 * Does not require a console UI — this string is what gets submitted to AI.
 */
export function formatHiddenPreviewFailureForAgent(message: string, pageUrl?: string): string {
  const absoluteUrl = extractAbsoluteApiUrl(message);
  const lines = [
    '【页面上看不到的报错】预览页界面正常，但后台请求/控制台有失败。请根据下面信息修复（不要只改 UI）。',
    message.trim(),
  ];
  if (pageUrl?.trim()) lines.push(`[页面] ${pageUrl.trim()}`);
  if (absoluteUrl) lines.push(`[请求地址] ${absoluteUrl}`);
  return lines.join('\n');
}

/** @deprecated */
export function formatPreviewApiFailureForAgent(message: string, pageUrl?: string): string {
  return formatHiddenPreviewFailureForAgent(message, pageUrl);
}

/** @deprecated */
export function isActionablePreviewConsoleMessage(_level: number, message: string): boolean {
  return isHiddenPreviewFailureMessage(message);
}

/** @deprecated */
export function formatPreviewConsoleErrorForAgent(message: string, pageUrl?: string): string {
  return formatHiddenPreviewFailureForAgent(message, pageUrl);
}

/**
 * Injected into preview guest on dom-ready.
 * Hooks fetch so Failed to fetch / HTTP errors always hit console.error
 * (webview console-message), even when the page UI swallows the error.
 */
export const PREVIEW_NETWORK_CAPTURE_SCRIPT = `(() => {
  if (window.__sclawPreviewNetworkHooked) return;
  window.__sclawPreviewNetworkHooked = true;
  const report = (payload) => {
    try {
      console.error('[sclaw-preview-network] ' + JSON.stringify(payload));
    } catch (_) {}
  };
  const wrap = (input, init, result) => {
    const method = (init && init.method) || 'GET';
    let url = '';
    try {
      if (typeof input === 'string') url = input;
      else if (input && typeof input.url === 'string') url = input.url;
      else url = String(input);
    } catch (_) { url = '(unknown)'; }
    report(Object.assign({ method, url }, result));
  };
  const orig = window.fetch.bind(window);
  window.fetch = function(input, init) {
    return orig(input, init).then((res) => {
      if (!res.ok) {
        wrap(input, init, { ok: false, status: res.status, statusText: res.statusText || '' });
      }
      return res;
    }).catch((err) => {
      wrap(input, init, {
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
      throw err;
    });
  };
})();`;
