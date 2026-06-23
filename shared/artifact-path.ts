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

/**
 * Expand ~/.stoclaw, /.stoclaw, and legacy ~/.openclaw/workspace aliases.
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

    // Legacy standalone OpenClaw workspace → StoClaw layout
    path = path.replace(
      /([/\\])\.openclaw([/\\])workspace/g,
      '$1.stoclaw$2openclaw$2workspace',
    );
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
