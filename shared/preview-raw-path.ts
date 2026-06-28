/**
 * Shared rules for raw file-path extraction in chat history / tool output.
 * Keeps file:// matching and local attach constraints in one place.
 */

/** Delimiters where a file:// URL ends in prose. Spaces are allowed inside the path. */
export function createFileUrlInTextRegex(): RegExp {
  return /file:\/\/(\/[A-Za-z]:[\\/][^)\]"',;<>]+|\/[^)\]"',;<>]+)/g;
}

/** @deprecated Use createFileUrlInTextRegex() — global regex must not be shared across calls. */
export const FILE_URL_IN_TEXT_REGEX = createFileUrlInTextRegex();

/** Extensions honored by extractRawFilePaths (images + common preview docs). */
export const RAW_ATTACHABLE_EXT_PATTERN =
  'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|html?|rtf|epub|' +
  'zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';

const RAW_ATTACHABLE_BASENAME_RE = new RegExp(
  `\\.(${RAW_ATTACHABLE_EXT_PATTERN})$`,
  'i',
);

/** Convert a file:// regex capture group to a local path (Windows /C:/ → C:/). */
export function localPathFromFileUrlCapture(captured: string): string {
  return captured.match(/^\/[A-Za-z]:/) ? captured.slice(1) : captured;
}

/** True when basename ends with a known attachable extension (filename may contain spaces). */
export function isPlausibleLocalFilePath(filePath: string): boolean {
  const trimmed = filePath.trim();
  if (!trimmed) return false;

  // Reject extension-list fragments like "/ .docx / .xlsx / .pdf / .csv" from skill docs.
  if (/^\/\s*(?:\.\w+\s*(?:\/\s*)?)+\.?\w*\s*$/i.test(trimmed)) return false;

  const segments = trimmed.split(/[\\/]/).filter((s) => s.trim().length > 0);
  if (segments.length === 0) return false;
  if (segments.every((s) => /^\s*\.\w+\s*$/i.test(s))) return false;

  const base = segments[segments.length - 1]!.trim();
  if (/^\.\w+$/i.test(base)) return false;

  const stem = base.replace(/\.[^.\\/]+$/, '').trim();
  if (!stem || !/[\w\u4e00-\u9fff-]/.test(stem)) return false;

  return true;
}

export function isAttachableRawLocalPath(filePath: string): boolean {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return false;
  }
  if (!isPlausibleLocalFilePath(trimmed)) return false;
  const base = trimmed.split(/[\\/]/).pop() || '';
  if (!base || base === '.' || base === '..') return false;
  return RAW_ATTACHABLE_BASENAME_RE.test(base);
}

/** Skip raw-path scan on tool output that is skill/doc front matter, not user artifacts. */
export function shouldSkipRawPathToolText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('--- name:') && trimmed.includes('\ndescription:');
}

/** Absolute path regexes — last path segment may contain spaces before the extension. */
export function buildRawAbsolutePathRegex(extPattern: string = RAW_ATTACHABLE_EXT_PATTERN): {
  unix: RegExp;
  winBackslash: RegExp;
  winForward: RegExp;
} {
  const file = `[^\\n"'()\\[\\],<>]+\\.(?:${extPattern})`;
  return {
    unix: new RegExp(`(?<![\\w./:])((?:\\/|~\\/)(?:[^\\n"'()\\[\\],<>/]+\\/)*${file})`, 'gi'),
    winBackslash: new RegExp(
      `(?<![\\w])([A-Za-z]:\\\\(?:[^\\n"'()\\[\\],<>\\\\]+\\\\)*${file})`,
      'gi',
    ),
    winForward: new RegExp(
      `(?<![\\w])([A-Za-z]:\\/(?:[^\\n"'()\\[\\],<>/]+\\/)*${file})`,
      'gi',
    ),
  };
}

/** Drop a path that is a strict prefix of another attachable path (regex truncation sibling). */
export function isTruncatedLocalPathPrefix(shorter: string, longer: string): boolean {
  const a = shorter.trim();
  const b = longer.trim();
  if (!a || !b || a === b || a.length >= b.length) return false;
  if (!b.startsWith(a)) return false;
  const next = b.charAt(a.length);
  if (next && !/[\s/\\.-]/.test(next)) return false;
  return isAttachableRawLocalPath(b) && !isAttachableRawLocalPath(a);
}
