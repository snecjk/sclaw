import type { AttachedFileMeta } from '@/stores/chat';
import { safeDecodeURIComponent } from '@/lib/safe-decode-uri';

export function isHttpUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * Normalize a local file path before Host API read/serve.
 * ReactMarkdown may percent-encode backslashes in preview:// hrefs (C:\ → C:%5C…),
 * which makes Node isAbsolute() false and causes workspace join bugs on Windows.
 */
export function normalizeLocalFilePath(filePath: string): string {
  let path = filePath.trim();
  if (!path || isHttpUrl(path) || path.startsWith('artifact://')) return path;

  if (path.includes('%')) {
    const once = safeDecodeURIComponent(path);
    path = once.includes('%') ? safeDecodeURIComponent(once) : once;
  }

  return path;
}

/** True for Windows drive paths (C:\ or C:/). */
export function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

/** Basename without query string, URI-decoded (works for both paths and URLs). */
export function previewBasename(pathOrUrl: string): string {
  return safeDecodeURIComponent(pathOrUrl.split(/[\\/]/).pop()?.split('?')[0] || pathOrUrl);
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    pdf: 'application/pdf',
    md: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    xml: 'application/xml',
    yaml: 'text/plain',
    yml: 'text/plain',
    sql: 'text/plain',
    py: 'text/plain',
    js: 'text/plain',
    ts: 'text/plain',
    jsx: 'text/plain',
    tsx: 'text/plain',
    sh: 'text/plain',
    bash: 'text/plain',
    java: 'text/plain',
    go: 'text/plain',
    rs: 'text/plain',
    css: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

/** True when the last path segment looks like a file name with extension (e.g. report.pdf). */
export function urlPathHasFileExtension(pathOrUrl: string): boolean {
  let segment = '';
  if (isHttpUrl(pathOrUrl)) {
    try {
      segment = new URL(pathOrUrl).pathname.split('/').filter(Boolean).pop() || '';
    } catch {
      segment = previewBasename(pathOrUrl);
    }
  } else {
    segment = previewBasename(pathOrUrl);
  }
  return /\.[a-z0-9]{1,12}$/i.test(segment);
}

function extFromPathOrUrl(pathOrUrl: string): string {
  if (isHttpUrl(pathOrUrl)) {
    if (!urlPathHasFileExtension(pathOrUrl)) return '';
    try {
      const last = new URL(pathOrUrl).pathname.split('/').filter(Boolean).pop() || '';
      return last.split('.').pop()?.toLowerCase() || '';
    } catch {
      // fall through to basename
    }
  }
  return previewBasename(pathOrUrl).split('.').pop()?.toLowerCase() || '';
}

/** http(s) URL whose path has no file extension — treat as a web page (e.g. https://www.baidu.com). */
export function isExtensionlessWebUrl(url: string): boolean {
  return isHttpUrl(url) && !urlPathHasFileExtension(url);
}

/** Remote .html/.htm file URL (OSS/CDN) — may need fetch before iframe (Content-Disposition: attachment). */
export function isRemoteFileHtmlUrl(url: string): boolean {
  if (!isHttpUrl(url) || isExtensionlessWebUrl(url)) return false;
  const ext = extFromPathOrUrl(url);
  return ext === 'html' || ext === 'htm';
}

/** Infer MIME type from a local path or remote URL (extension-based). */
export function inferMimeTypeFromPath(pathOrUrl: string): string {
  const ext = extFromPathOrUrl(pathOrUrl);
  if (ext) return extToMimeType(ext);
  if (isHttpUrl(pathOrUrl) && isExtensionlessWebUrl(pathOrUrl)) return 'text/html';
  return 'application/octet-stream';
}

/** Infer MIME type from artifact type hint and/or URL/path extension. */
export function inferMimeTypeFromUrl(url: string, typeHint?: string | null): string {
  const hint = typeHint?.toLowerCase().trim();
  if (hint === 'html' || hint === 'text/html') return 'text/html';
  if (hint === 'pdf' || hint === 'application/pdf') return 'application/pdf';
  if (hint === 'json' || hint === 'application/json') return 'application/json';
  if (hint === 'markdown' || hint === 'text/markdown') return 'text/markdown';
  if (hint === 'csv' || hint === 'text/csv') return 'text/csv';
  if (hint === 'output') {
    if (/\.html?(?:\?|$)/i.test(url)) return 'text/html';
    return 'text/html';
  }

  return inferMimeTypeFromPath(url);
}

const PREVIEWABLE_REMOTE_MIMES = new Set([
  'text/html',
  'application/pdf',
  'text/markdown',
  'application/json',
  'text/plain',
  'text/csv',
]);

/** Remote http(s) URLs we can render in the side preview panel. */
export function isPreviewableRemoteUrl(url: string, typeHint?: string | null): boolean {
  if (!isHttpUrl(url)) return false;
  return PREVIEWABLE_REMOTE_MIMES.has(inferMimeTypeFromUrl(url, typeHint));
}

/** Display label for a http(s) URL used in markdown links / file cards. */
export function previewHttpUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    if (segment) return safeDecodeURIComponent(segment);
    return parsed.hostname || url;
  } catch {
    return safeDecodeURIComponent(url.split('/').pop()?.split('?')[0] || '链接');
  }
}

export function previewFileNameFromUrl(url: string, mimeType?: string): string {
  const fromUrl = previewHttpUrlLabel(url);
  if (fromUrl && fromUrl !== url && fromUrl.includes('.')) return fromUrl;
  if (mimeType === 'text/html') return `${fromUrl || 'page'}.html`;
  if (mimeType === 'application/json') return `${fromUrl || 'data'}.json`;
  return fromUrl || 'preview';
}

export function isPreviewableArtifactUrl(url: string, typeHint?: string | null): boolean {
  if (!url?.trim()) return false;
  if (isHttpUrl(url)) return isPreviewableRemoteUrl(url, typeHint);
  if (url.startsWith('artifact://')) return false;
  return false;
}

/** HTTP(S) artifact URLs users can open or preview; hides internal artifact:// refs. */
export function isUserFacingArtifactUrl(url: string | undefined | null): boolean {
  return Boolean(url?.trim() && isHttpUrl(url));
}

/** Open http(s) links in the system browser — required in Electron (plain <a> navigates in-app). */
export function openExternalUrl(url: string): void {
  if (!url?.trim() || !isHttpUrl(url)) return;
  void window.electron?.openExternal(url);
}

/** Resolve bare filenames / artifact names to OSS URL from hydrated workflow card state. */
export function resolveArtifactUrlFromWorkflowStates(
  hint: string,
  states: Record<string, { result?: { artifacts?: Array<{ name: string; url: string }> } } | undefined>,
): string | null {
  const normalized = hint.trim();
  if (!normalized) return null;
  if (isHttpUrl(normalized)) return normalized;

  const basename = safeDecodeURIComponent(normalized.split('/').pop()?.split('?')[0] || normalized);
  for (const state of Object.values(states)) {
    for (const artifact of state?.result?.artifacts ?? []) {
      const url = artifact.url?.trim();
      if (!url || !isHttpUrl(url)) continue;
      const urlBase = safeDecodeURIComponent(url.split('/').pop()?.split('?')[0] || '');
      if (
        artifact.name === normalized
        || artifact.name === basename
        || urlBase === basename
        || url.includes(basename)
      ) {
        return url;
      }
    }
  }
  return null;
}

export function resolvePreviewLinkTarget(
  href: string,
  states: Record<string, { result?: { artifacts?: Array<{ name: string; url: string }> } } | undefined>,
): string {
  const raw = normalizeLocalFilePath(
    href.startsWith('preview://') ? href.slice('preview://'.length) : href,
  );
  return resolveArtifactUrlFromWorkflowStates(raw, states) ?? raw;
}

export function artifactToPreviewFile(artifact: {
  id?: string;
  name: string;
  type: string;
  url: string;
}): AttachedFileMeta {
  const mimeType = inferMimeTypeFromUrl(artifact.url, artifact.type);
  const fileName = artifact.name && artifact.name !== 'preview' && !artifact.name.startsWith('http')
    ? (artifact.name.includes('.') ? artifact.name : previewFileNameFromUrl(artifact.url, mimeType))
    : previewFileNameFromUrl(artifact.url, mimeType);

  return {
    filePath: artifact.url,
    fileName,
    mimeType,
    fileSize: 0,
    preview: null,
  };
}

/** Strip trailing sentence punctuation accidentally captured with a URL. */
export function normalizeHttpUrlToken(url: string): string {
  return url.replace(/[.,;:!?)}\]]+$/, '');
}

/** Match all http(s) URLs in plain text. */
export function extractPreviewableHttpUrls(text: string): Array<{ filePath: string; fileName: string; mimeType: string }> {
  const regex = /(https?:\/\/[^\s)\]"',;<>]+)/gi;
  const results: Array<{ filePath: string; fileName: string; mimeType: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const url = normalizeHttpUrlToken(match[1]);
    if (!url || seen.has(url) || !isPreviewableRemoteUrl(url)) continue;
    seen.add(url);
    const mimeType = inferMimeTypeFromUrl(url);
    results.push({
      filePath: url,
      fileName: previewFileNameFromUrl(url, mimeType),
      mimeType,
    });
  }
  return results;
}
