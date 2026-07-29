import type { AttachedFileMeta } from '@/stores/chat';
import { safeDecodeURIComponent } from '@/lib/safe-decode-uri';
import {
  extensionFromBasename,
  normalizeArtifactPathPrefix,
} from '../../shared/artifact-path';
import { classifyPreviewHref, isStoCompanyUrl } from '../../shared/preview-href';

export function isHttpUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * Windows drive paths only: use forward slashes so markdown link parsers do not treat
 * `\.` as an escaped dot (e.g. `admin\.stoclaw` → `admin.stoclaw`). Unix paths unchanged.
 */
export function toMarkdownPreviewPath(filePath: string): string {
  const path = filePath.trim();
  if (!path || isHttpUrl(path) || path.startsWith('preview://') || path.startsWith('artifact://')) {
    return path;
  }
  if (isWindowsDrivePath(path)) {
    return path.replace(/\\/g, '/');
  }
  return path;
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

  const homeDir = typeof process !== 'undefined'
    ? (process.env.HOME || process.env.USERPROFILE || '')
    : '';
  if (homeDir) {
    path = normalizeArtifactPathPrefix(path, homeDir);
  } else {
    path = toMarkdownPreviewPath(path);
  }

  return toMarkdownPreviewPath(path);
}

/** True for Windows drive paths (C:\ or C:/). */
export function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

/** Basename without query string, URI-decoded (works for both paths and URLs). */
export function previewBasename(pathOrUrl: string): string {
  return safeDecodeURIComponent(pathOrUrl.split(/[\\/]/).pop()?.split('?')[0] || pathOrUrl);
}

const OFFICE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
]);

const BINARY_PREVIEW_MIME_TYPES = new Set([
  ...OFFICE_MIME_TYPES,
  'application/pdf',
]);

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
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

export function isBinaryPreviewMime(mimeType: string): boolean {
  return BINARY_PREVIEW_MIME_TYPES.has(mimeType);
}

export function isOfficePreviewMime(mimeType: string): boolean {
  return OFFICE_MIME_TYPES.has(mimeType);
}

/**
 * Reconcile declared MIME with file extension. Prevents binary Office/PDF files from
 * being read as UTF-8 text when upstream metadata is wrong (e.g. text/csv for .xlsx).
 */
export function resolvePreviewMimeType(
  mimeType: string,
  filePath: string,
  fileName = '',
): string {
  const pathMime = inferMimeTypeFromPath(filePath);
  const nameMime = fileName && fileName !== filePath ? inferMimeTypeFromPath(fileName) : '';
  const extMime = pathMime !== 'application/octet-stream' ? pathMime : nameMime;

  if (extMime === 'application/octet-stream') {
    return mimeType || extMime;
  }

  const declared = mimeType?.trim() || '';
  if (!declared || declared === 'application/octet-stream') {
    return extMime;
  }

  if (isBinaryPreviewMime(extMime) && !isBinaryPreviewMime(declared)) {
    return extMime;
  }

  if (extMime === declared) return declared;

  // e.g. text/csv declared but .xlsx extension — trust extension for known binary types
  if (isBinaryPreviewMime(extMime)) return extMime;

  return declared;
}

/** True when the last path segment looks like a file name with extension (e.g. report.pdf). */
export function urlPathHasFileExtension(pathOrUrl: string): boolean {
  let segment: string;
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
      return extensionFromBasename(last);
    } catch {
      // fall through to basename
    }
  }
  return extensionFromBasename(previewBasename(pathOrUrl));
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
  if (hint === 'html' || hint === 'text/html' || hint === 'html_report' || hint === 'html-report') {
    return 'text/html';
  }
  if (hint === 'pdf' || hint === 'application/pdf') return 'application/pdf';
  if (hint === 'json' || hint === 'application/json') return 'application/json';
  if (hint === 'markdown' || hint === 'text/markdown') return 'text/markdown';
  if (hint === 'csv' || hint === 'text/csv') return 'text/csv';
  if (hint === 'xlsx' || hint === 'excel'
    || hint === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (hint === 'xls' || hint === 'application/vnd.ms-excel') return 'application/vnd.ms-excel';
  if (hint === 'docx' || hint === 'word'
    || hint === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (hint === 'doc' || hint === 'application/msword') return 'application/msword';
  if (hint === 'pptx' || hint === 'ppt'
    || hint === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  if (hint === 'output') {
    if (/\.html?(?:\?|$)/i.test(url)) return 'text/html';
    return 'text/html';
  }

  return inferMimeTypeFromPath(url);
}

/** Remote http(s) URLs we can render in the side preview panel (company *.sto* domains only). */
export function isPreviewableRemoteUrl(url: string, _typeHint?: string | null): boolean {
  if (!isHttpUrl(url)) return false;
  return isStoCompanyUrl(url);
}

/** Query params that carry the real artifact path on proxy preview URLs (e.g. agentrun/artifact/preview). */
const ARTIFACT_PATH_QUERY_KEYS = ['filePath', 'path', 'file', 'filename'] as const;

const GENERIC_PREVIEW_PATH_SEGMENTS = new Set(['preview', 'download', 'file', 'artifact', 'output']);

function basenameFromArtifactPreviewUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    for (const key of ARTIFACT_PATH_QUERY_KEYS) {
      const value = parsed.searchParams.get(key)?.trim();
      if (value) return previewBasename(value);
    }
  } catch {
    // fall through
  }
  return null;
}

function mimeTypeDefaultExtension(mimeType?: string): string {
  if (mimeType === 'text/html') return 'html';
  if (mimeType === 'application/json') return 'json';
  if (mimeType === 'text/markdown') return 'md';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/csv') return 'csv';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return '';
}

function appendExtensionIfMissing(label: string, mimeType?: string): string {
  if (!label || label.includes('.')) return label;
  const ext = mimeTypeDefaultExtension(mimeType);
  return ext ? `${label}.${ext}` : label;
}

function resolveArtifactPreviewFileName(
  artifactName: string,
  previewUrl: string,
  mimeType: string,
): string {
  const name = artifactName?.trim() ?? '';
  if (name && name !== 'preview' && !name.startsWith('http')) {
    return name;
  }
  return previewFileNameFromUrl(previewUrl, mimeType);
}

/** Display label for a http(s) URL used in markdown links / file cards. */
export function previewHttpUrlLabel(url: string): string {
  const fromQuery = basenameFromArtifactPreviewUrl(url);
  if (fromQuery) return fromQuery;

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
  if (fromUrl && !GENERIC_PREVIEW_PATH_SEGMENTS.has(fromUrl.toLowerCase())) {
    return appendExtensionIfMissing(fromUrl, mimeType);
  }
  const ext = mimeTypeDefaultExtension(mimeType);
  if (ext) return `${fromUrl || 'preview'}.${ext}`;
  return fromUrl || 'preview';
}

export function isPreviewableArtifactUrl(url: string, typeHint?: string | null): boolean {
  if (!url?.trim()) return false;
  if (isHttpUrl(url)) return isPreviewableRemoteUrl(url, typeHint);
  if (url.startsWith('artifact://')) return false;
  return classifyPreviewHref(url).type === 'local';
}

/** User-visible remote or local artifacts; hides internal artifact:// and unsafe schemes. */
export function isUserFacingArtifactUrl(url: string | undefined | null): boolean {
  if (!url?.trim() || url.startsWith('artifact://')) return false;
  const type = classifyPreviewHref(url).type;
  return type === 'local' || type === 'http-preview' || type === 'http-external';
}

/** Open http(s) links in the system browser — required in Electron (plain <a> navigates in-app). */
export function openExternalUrl(url: string): void {
  if (!url?.trim()) return;
  void window.electron?.openExternal(url.trim());
}

/** Resolve bare filenames / artifact names to preview OSS URL from hydrated workflow card state. */
export function resolveArtifactUrlFromWorkflowStates(
  hint: string,
  states: Record<string, { result?: { artifacts?: Array<{ name: string; url: string; previewUrl?: string }> } } | undefined>,
): string | null {
  const normalized = hint.trim();
  if (!normalized) return null;
  if (isHttpUrl(normalized)) return normalized;

  const basename = safeDecodeURIComponent(normalized.split('/').pop()?.split('?')[0] || normalized);
  for (const state of Object.values(states)) {
    for (const artifact of state?.result?.artifacts ?? []) {
      const url = (artifact.previewUrl ?? artifact.url)?.trim();
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
  states: Record<string, { result?: { artifacts?: Array<{ name: string; url: string; previewUrl?: string }> } } | undefined>,
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
  previewUrl?: string;
  tempUrl?: string;
  filePath?: string;
}): AttachedFileMeta {
  const previewUrl = artifact.previewUrl?.trim() || artifact.url;
  const downloadUrl = artifact.tempUrl?.trim() || artifact.url;
  const localFilePath = artifact.filePath?.trim();
  const mimeType = resolvePreviewMimeType(
    inferMimeTypeFromUrl(previewUrl, artifact.type),
    previewUrl,
    artifact.name,
  );
  const fileName = resolveArtifactPreviewFileName(artifact.name, previewUrl, mimeType);

  return {
    // Workflow artifacts may include both an in-app/OSS preview URL and a
    // local output path. Keep the latter for native actions such as “show in
    // folder”; preview components can render the local file directly.
    filePath: localFilePath || previewUrl,
    downloadUrl: downloadUrl !== previewUrl ? downloadUrl : undefined,
    fileName,
    mimeType,
    fileSize: 0,
    preview: null,
  };
}
