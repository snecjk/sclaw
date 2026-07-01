/**
 * Shared preview href classification for StoClaw.
 * Determines how a link should be handled: local preview, side-panel http preview, or external open.
 */

export type PreviewHrefType = 'local' | 'http-preview' | 'http-external' | 'external' | 'blocked';

export interface PreviewHrefResult {
  type: PreviewHrefType;
  target: string;
  /** Original href (for debugging / display). */
  raw: string;
}

const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:']);

const EXTERNAL_SCHEMES = new Set([
  'ftp:', 'ftps:', 'sftp:',
  'mailto:', 'tel:', 'sms:',
  'file:', // file:// handled specially below
  'dingtalk:', 'wxwork:', 'weixin:',
  'slack:', 'discord:',
]);

/** True when URL hostname contains company `.sto` segment (e.g. *.sto.cn). */
export function isStoCompanyUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes('.sto');
  } catch {
    return false;
  }
}

function looksLikeLocalPath(href: string): boolean {
  // Absolute Unix path
  if (href.startsWith('/')) return true;
  // Windows drive path (C:\ or C:/)
  if (/^[A-Za-z]:[\\/]/.test(href)) return true;
  // Relative path with ./ or ../
  if (href.startsWith('./') || href.startsWith('../')) return true;
  // UNC path \\server\share
  if (href.startsWith('\\\\')) return true;
  return false;
}

/**
 * Classify an href into how it should be handled.
 * - 'local': file://, preview://, or bare local path → resolve via Main → side panel preview
 * - 'http-preview': company *.sto* domain http(s) → side panel preview
 * - 'http-external': other http(s) → open in system browser
 * - 'external': ftp://, dingtalk://, etc. → openExternal
 * - 'blocked': javascript:, data:, etc. → ignore
 */
export function classifyPreviewHref(href: string): PreviewHrefResult {
  const raw = href.trim();
  if (!raw) return { type: 'blocked', target: '', raw };

  const lower = raw.toLowerCase();

  // Block dangerous schemes
  const schemeEnd = lower.indexOf(':');
  if (schemeEnd >= 0) {
    const scheme = lower.slice(0, schemeEnd + 1);
    if (BLOCKED_SCHEMES.has(scheme)) {
      return { type: 'blocked', target: '', raw };
    }
    if (EXTERNAL_SCHEMES.has(scheme) && scheme !== 'file:') {
      return { type: 'external', target: raw, raw };
    }
  }

  // preview:// scheme (used internally by StoClaw)
  if (lower.startsWith('preview://')) {
    return { type: 'local', target: raw.slice('preview://'.length), raw };
  }

  // file:// scheme
  if (lower.startsWith('file://')) {
    let path = raw.slice('file://'.length);
    // Windows: /C:/Users/... → C:/Users/...
    if (path.startsWith('/') && /^\/[A-Za-z]:/.test(path)) {
      path = path.slice(1);
    }
    return { type: 'local', target: path, raw };
  }

  // http(s) URLs
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    // localhost / 127.0.0.1 treated as local previewable
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(raw)) {
      return { type: 'local', target: raw, raw };
    }
    if (isStoCompanyUrl(raw)) {
      return { type: 'http-preview', target: raw, raw };
    }
    return { type: 'http-external', target: raw, raw };
  }

  // Bare local path (no scheme)
  if (looksLikeLocalPath(raw)) {
    return { type: 'local', target: raw, raw };
  }

  // Unknown scheme → external
  if (schemeEnd >= 0) {
    return { type: 'external', target: raw, raw };
  }

  // Fallback: treat as external (e.g. bare words that aren't paths)
  return { type: 'external', target: raw, raw };
}

/**
 * Check if an href should be previewable in the side panel.
 */
export function isPreviewableHref(href: string): boolean {
  const result = classifyPreviewHref(href);
  return result.type === 'local' || result.type === 'http-preview';
}

/**
 * Strip internal preview scheme from a path string.
 */
export function stripPreviewScheme(path: string): string {
  if (path.startsWith('preview://')) return path.slice('preview://'.length);
  return path;
}
