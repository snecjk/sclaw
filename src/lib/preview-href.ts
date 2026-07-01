import {
  classifyPreviewHref,
  isPreviewableHref,
  stripPreviewScheme,
  type PreviewHrefResult,
} from '../../shared/preview-href';
import { hostApiFetch } from '@/lib/host-api';
import { isHttpUrl, normalizeLocalFilePath, toMarkdownPreviewPath } from '@/lib/preview-url';

export type PreviewHrefAction =
  | { action: 'preview-local'; path: string }
  | { action: 'preview-remote'; url: string }
  | { action: 'open-external'; url: string }
  | { action: 'unsupported' };

export {
  classifyPreviewHref,
  isPreviewableHref,
  stripPreviewScheme,
};
export type { PreviewHrefResult };

export function isHttpPreviewHref(href: string): boolean {
  const lower = href.trim().toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}

export function isExternalAppHref(href: string): boolean {
  return classifyPreviewHref(href).type === 'external';
}

export function extractLocalPathFromHref(href: string): string {
  let trimmed = href.trim();
  if (!trimmed) return trimmed;

  if (trimmed.toLowerCase().startsWith('preview://')) {
    return toMarkdownPreviewPath(stripPreviewScheme(trimmed));
  }

  if (/^file:\\/i.test(trimmed)) {
    trimmed = trimmed.replace(/^file:\\/i, '');
  }

  const result = classifyPreviewHref(trimmed);
  if (result.type === 'local') {
    return toMarkdownPreviewPath(result.target || trimmed);
  }

  if (trimmed.toLowerCase().startsWith('file://')) {
    return toMarkdownPreviewPath(classifyPreviewHref(trimmed).target);
  }

  return toMarkdownPreviewPath(trimmed);
}

export function toPreviewPathSeparators(filePath: string): string {
  return toMarkdownPreviewPath(filePath);
}

/** Coerce href for ReactMarkdown urlTransform — local paths become preview:// */
export function coerceHrefForMarkdownTransform(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return trimmed;

  const result = classifyPreviewHref(trimmed);
  if (result.type === 'blocked') return null;
  if (result.type === 'local') {
    const path = toPreviewPathSeparators(extractLocalPathFromHref(trimmed));
    return path ? `preview://${path}` : null;
  }
  return trimmed;
}

/** Resolve a markdown href to a preview action (sync classification). */
export function resolvePreviewHrefAction(href: string): PreviewHrefAction {
  const trimmed = href.trim();
  if (!trimmed) return { action: 'unsupported' };

  if (trimmed.startsWith('artifact://')) return { action: 'unsupported' };

  const result = classifyPreviewHref(trimmed);

  if (result.type === 'blocked') return { action: 'unsupported' };

  if (result.type === 'http-preview') {
    return { action: 'preview-remote', url: result.target };
  }

  if (result.type === 'http-external' || result.type === 'external') {
    return { action: 'open-external', url: result.target };
  }

  if (result.type === 'local') {
    const rawTarget = result.target || extractLocalPathFromHref(trimmed);
    if (isHttpUrl(rawTarget)) {
      return classifyPreviewHref(rawTarget).type === 'http-preview'
        ? { action: 'preview-remote', url: rawTarget }
        : { action: 'open-external', url: rawTarget };
    }
    const localPath = normalizeLocalFilePath(toPreviewPathSeparators(rawTarget));
    if (!localPath || isHttpUrl(localPath)) return { action: 'unsupported' };
    return { action: 'preview-local', path: localPath };
  }

  return { action: 'unsupported' };
}

/** Ask Main to resolve a path hint to an on-disk file (search fallback). */
export async function resolvePreviewPathOnHost(hint: string): Promise<{ path: string; exists: boolean }> {
  const res = await hostApiFetch<{ path: string; exists: boolean }>('/api/files/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: hint }),
  });
  return {
    path: res?.path || hint,
    exists: res?.exists === true,
  };
}
