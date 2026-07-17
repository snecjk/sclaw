/**
 * Shared artifact path normalization for StoClaw preview + skill output.
 * Pass `homeDir` from the host (Electron main or renderer with process.env).
 */

export function isArtifactHttpUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

export function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

/** Strip `file://` and normalize Windows drive prefix (/C:/ → C:/). */
export function stripFileUrlScheme(path: string): string {
  if (!path.startsWith('file://')) return path;
  let stripped = path.slice('file://'.length);
  if (/^\/[A-Za-z]:/.test(stripped)) stripped = stripped.slice(1);
  return stripped;
}

/** Legacy standalone OpenClaw workspace segment (`/.openclaw/workspace`). */
const LEGACY_OPENCLAW_WORKSPACE_RE = /([/\\])\.openclaw([/\\])workspace/g;
/** Previous StoClaw layout before workspace lift-out (`/.stoclaw/openclaw/workspace`). */
const LEGACY_STOCLAW_OPENCLAW_WORKSPACE_RE = /([/\\])\.stoclaw([/\\])openclaw([/\\])workspace/g;

/**
 * Map legacy workspace paths to the shared StoClaw layout (`~/.stoclaw/workspace`).
 * Callers should try the original path on disk first; use this only as a fallback candidate.
 */
export function migrateLegacyOpenClawWorkspacePath(filePath: string): string {
  if (!filePath) return filePath;
  let result = filePath.replace(
    LEGACY_STOCLAW_OPENCLAW_WORKSPACE_RE,
    '$1.stoclaw$2workspace',
  );
  result = result.replace(
    LEGACY_OPENCLAW_WORKSPACE_RE,
    '$1.stoclaw$2workspace',
  );
  return result;
}

/**
 * Expand ~/.stoclaw and /.stoclaw prefixes; normalize Windows separators.
 * Does not rewrite legacy `.openclaw/workspace` — resolution checks both layouts on disk.
 * Requires `homeDir` (e.g. os.homedir() or process.env.HOME).
 */
export function normalizeArtifactPathPrefix(filePath: string, homeDir: string): string {
  let path = filePath.trim();
  if (!path || isArtifactHttpUrl(path) || path.startsWith('artifact://')) return path;

  path = stripFileUrlScheme(path);

  if (homeDir) {
    if (path.startsWith('~')) {
      path = path.replace(/^~(?=$|[/\\])/, homeDir).replace(/^~([/\\])/, `${homeDir}$1`);
    } else if (path.startsWith('/.stoclaw')) {
      path = `${homeDir}${path}`;
    }
  }

  if (isWindowsDrivePath(path)) {
    path = path.replace(/\\/g, '/');
  }

  return path;
}

/** Longest-suffix extension match (tsv before ts, html before htm). */
const KNOWN_FILE_EXTENSIONS = [
  'properties', 'swift', 'scala', 'bash', 'fish', 'html', 'htm', 'java', 'jsx', 'tsx',
  'cpp', 'php', 'toml', 'conf', 'scss', 'less', 'zsh', 'yaml', 'yml', 'json', 'sql',
  'xml', 'csv', 'tsv', 'txt', 'log', 'ini', 'env', 'md', 'py', 'go', 'rs', 'cs', 'rb',
  'mm', 'bat', 'cmd', 'pdf', 'kt', 'css', 'ts', 'js', 'sh', 'c', 'h', 'r', 'm',
] as const;

export function extensionFromBasename(basename: string): string {
  const lower = basename.toLowerCase();
  for (const ext of KNOWN_FILE_EXTENSIONS) {
    if (lower.endsWith(`.${ext}`)) return ext;
  }
  return basename.split('.').pop()?.toLowerCase() || '';
}

/** Extension alternation for path regex — longest tokens first. */
export const PREVIEWABLE_FILE_EXT_PATTERN = KNOWN_FILE_EXTENSIONS.join('|');
