/**
 * Pure decision helpers for embed-webview window.open / target=_blank.
 * Used by Main setWindowOpenHandler and unit tests.
 */

export type SclawEmbedWindowOpenAction =
  | { kind: 'open-tab'; url: string }
  | { kind: 'download'; url: string }
  | { kind: 'deny' };

/** File / export URLs that should download instead of opening a plaza tab. */
export function isSclawEmbedLikelyDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (
      /\.(xlsx?|xlsm|csv|tsv|pdf|zip|gz|tar|7z|rar|docx?|pptx?|html?|txt|json|xml|png|jpe?g|gif|webp)(?:\?|#|$)/i.test(
        parsed.pathname,
      )
    ) {
      return true;
    }
    return /(?:^|&)(?:download|attachment|export)=/i.test(parsed.search.slice(1));
  } catch {
    return false;
  }
}

export function isSclawEmbedHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Decide how an embed guest window.open URL should be handled. */
export function resolveSclawEmbedWindowOpenAction(url: string): SclawEmbedWindowOpenAction {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return { kind: 'deny' };
  if (!isSclawEmbedHttpUrl(trimmed)) return { kind: 'deny' };
  if (isSclawEmbedLikelyDownloadUrl(trimmed)) return { kind: 'download', url: trimmed };
  return { kind: 'open-tab', url: trimmed };
}
