import type { AttachedFileMeta } from '@/stores/chat';
import { safeDecodeURIComponent } from '@/lib/safe-decode-uri';

const PREVIEWABLE_REMOTE_EXTS =
  'html?|pdf|json|md|txt|csv|tsv|sql|py|js|ts|jsx|tsx|java|go|rs|cpp|c|h|cs|rb|php|yaml|yml|xml';

export function isHttpUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
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

function extFromPathOrUrl(pathOrUrl: string): string {
  if (isHttpUrl(pathOrUrl)) {
    try {
      const pathname = new URL(pathOrUrl).pathname;
      return pathname.split('/').pop()?.split('.').pop()?.toLowerCase() || '';
    } catch {
      // fall through to basename
    }
  }
  return previewBasename(pathOrUrl).split('.').pop()?.toLowerCase() || '';
}

/** Infer MIME type from a local path or remote URL (extension-based). */
export function inferMimeTypeFromPath(pathOrUrl: string): string {
  const ext = extFromPathOrUrl(pathOrUrl);
  return ext ? extToMimeType(ext) : 'application/octet-stream';
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

export function isPreviewableRemoteUrl(url: string, typeHint?: string | null): boolean {
  if (!isHttpUrl(url)) return false;
  const mime = inferMimeTypeFromUrl(url, typeHint);
  return (
    mime === 'text/html'
    || mime === 'application/pdf'
    || mime === 'text/markdown'
    || mime === 'application/json'
    || mime === 'text/plain'
    || mime === 'text/csv'
  );
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
  const raw = href.startsWith('preview://') ? href.slice('preview://'.length) : href;
  return resolveArtifactUrlFromWorkflowStates(raw, states) ?? raw;
}

export function artifactToPreviewFile(artifact: {
  id?: string;
  name: string;
  type: string;
  url: string;
}): AttachedFileMeta {
  const mimeType = inferMimeTypeFromUrl(artifact.url, artifact.type);
  const fileName = artifact.name.includes('.')
    ? artifact.name
    : `${artifact.name}${mimeType === 'text/html' ? '.html' : mimeType === 'application/json' ? '.json' : ''}`;

  return {
    filePath: artifact.url,
    fileName,
    mimeType,
    fileSize: 0,
    preview: null,
  };
}

/** Match previewable http(s) URLs in plain text (OSS/CDN links). */
export function extractPreviewableHttpUrls(text: string): Array<{ filePath: string; fileName: string; mimeType: string }> {
  const regex = new RegExp(`(https?:\\/\\/[^\\s)\\]"',;<>]+\\.(?:${PREVIEWABLE_REMOTE_EXTS})(?:\\?[^\\s)\\]"',;<>]*)?)`, 'gi');
  const results: Array<{ filePath: string; fileName: string; mimeType: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const url = match[1];
    if (seen.has(url) || !isPreviewableRemoteUrl(url)) continue;
    seen.add(url);
    const fileName = safeDecodeURIComponent(url.split('/').pop()?.split('?')[0] || 'preview');
    results.push({
      filePath: url,
      fileName,
      mimeType: inferMimeTypeFromUrl(url),
    });
  }
  return results;
}
