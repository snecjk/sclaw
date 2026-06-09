import type { AttachedFileMeta } from '@/stores/chat';

const PREVIEWABLE_REMOTE_EXTS =
  'html?|pdf|json|md|txt|csv|tsv|sql|py|js|ts|jsx|tsx|java|go|rs|cpp|c|h|cs|rb|php|yaml|yml|xml';

export function isHttpUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
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
    tsv: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

/** Infer MIME type from artifact type hint and/or URL path extension. */
export function inferMimeTypeFromUrl(url: string, typeHint?: string | null): string {
  const hint = typeHint?.toLowerCase().trim();
  if (hint === 'html' || hint === 'text/html') return 'text/html';
  if (hint === 'pdf' || hint === 'application/pdf') return 'application/pdf';
  if (hint === 'json' || hint === 'application/json') return 'application/json';
  if (hint === 'markdown' || hint === 'text/markdown') return 'text/markdown';
  if (hint === 'csv' || hint === 'text/csv') return 'text/csv';
  if (hint === 'output') {
    // Backend may label HTML artifacts as "output" before OSS link is fixed.
    if (/\.html?(?:\?|$)/i.test(url)) return 'text/html';
    return 'text/html';
  }

  try {
    const pathname = new URL(url).pathname;
    const fileName = pathname.split('/').pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext) return extToMimeType(ext);
  } catch {
    // ignore invalid URL
  }

  return 'text/html';
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
    const fileName = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'preview');
    results.push({
      filePath: url,
      fileName,
      mimeType: inferMimeTypeFromUrl(url),
    });
  }
  return results;
}
