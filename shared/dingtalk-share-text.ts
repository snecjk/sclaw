import { migrateLegacyOpenClawWorkspacePath, stripFileUrlScheme } from './artifact-path';
import { createFileUrlInTextRegex, localPathFromFileUrlCapture } from './preview-raw-path';

/** Normalize local paths for share-time lookup (slashes, no trailing slash). */
export function normalizeSharePathKey(path: string): string {
  let normalized = stripFileUrlScheme(path.trim());
  normalized = normalized.replace(/\\/g, '/');
  return normalized.replace(/\/+$/, '');
}

export function collectSharePathAliases(localPath: string): string[] {
  const trimmed = localPath.trim();
  if (!trimmed) return [];

  const keys = new Set<string>();
  const add = (value: string) => {
    const key = normalizeSharePathKey(value);
    if (key) keys.add(key);
  };

  add(trimmed);
  add(stripFileUrlScheme(trimmed));
  add(migrateLegacyOpenClawWorkspacePath(normalizeSharePathKey(trimmed)));
  add(migrateLegacyOpenClawWorkspacePath(stripFileUrlScheme(trimmed)));

  const bare = normalizeSharePathKey(trimmed);
  if (bare) {
    add(`file://${bare.startsWith('/') ? bare : `/${bare}`}`);
    if (/([/\\])\.stoclaw([/\\])openclaw([/\\])workspace/.test(bare)) {
      add(bare.replace(
        /([/\\])\.stoclaw([/\\])openclaw([/\\])workspace/,
        '$1.openclaw$2workspace',
      ));
    }
    if (/([/\\])\.openclaw([/\\])workspace/.test(bare)) {
      add(migrateLegacyOpenClawWorkspacePath(bare));
    }
  }

  return [...keys];
}

export function buildSharePathToUrlMap(
  entries: ReadonlyArray<{ localPath: string; shareUrl: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const shareUrl = entry.shareUrl.trim();
    if (!shareUrl) continue;
    for (const alias of collectSharePathAliases(entry.localPath)) {
      map.set(alias, shareUrl);
    }
  }
  return map;
}

function lookupShareUrl(rawPath: string, pathToUrl: ReadonlyMap<string, string>): string | undefined {
  for (const alias of collectSharePathAliases(rawPath)) {
    const url = pathToUrl.get(alias);
    if (url) return url;
  }
  return undefined;
}

/**
 * Replace local file refs in conversation text with shareable HTTP(S) URLs.
 * Keeps markdown labels; only swaps link targets (file:// → OSS, etc.).
 */
export function replaceConversationFileRefsWithShareUrls(
  text: string,
  pathToUrl: ReadonlyMap<string, string>,
): string {
  if (!text || pathToUrl.size === 0) return text;

  let result = text.replace(
    /\[([^\]]*)\]\((file:\/\/[^)\s]+)\)/g,
    (full, label: string, fileUrl: string) => {
      const shareUrl = lookupShareUrl(fileUrl, pathToUrl);
      return shareUrl ? `[${label}](${shareUrl})` : full;
    },
  );

  const fileUrlRegex = createFileUrlInTextRegex();
  result = result.replace(fileUrlRegex, (match, captured: string) => {
    const shareUrl = lookupShareUrl(`file://${captured}`, pathToUrl);
    return shareUrl ?? match;
  });

  return result;
}

/** Collect local file paths referenced inline as file:// URLs in conversation text. */
export function collectConversationFileRefsFromText(
  text: string,
): Array<{ fileName: string; filePath: string }> {
  const seen = new Set<string>();
  const results: Array<{ fileName: string; filePath: string }> = [];
  const regex = createFileUrlInTextRegex();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const localPath = localPathFromFileUrlCapture(match[1]!);
    const key = normalizeSharePathKey(localPath);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fileName = key.split('/').pop() || 'file';
    results.push({ fileName, filePath: localPath });
  }
  return results;
}
