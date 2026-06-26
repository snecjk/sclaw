import { isArtifactHttpUrl, isWindowsDrivePath } from './artifact-path';
import type { ToolWorkspaceHints } from './tool-workspace-hints';
import { parseToolOutputFiles } from './tool-output-files';

/** True when path is already absolute or remote — no join needed. */
export function isAbsoluteOrRemotePath(filePath: string): boolean {
  const p = filePath.trim();
  if (!p) return false;
  if (isArtifactHttpUrl(p) || p.startsWith('artifact://')) return true;
  return p.startsWith('/') || p.startsWith('~') || isWindowsDrivePath(p);
}

/** Pick workspace base for joining relative file names. */
export function workspaceBaseFromHints(hints: ToolWorkspaceHints): string | undefined {
  return hints.runDir?.trim() || hints.outputDir?.trim() || hints.cwd?.trim() || undefined;
}

/** Join base dir + relative file path (posix-style; Main may normalize further). */
export function joinWorkspacePath(baseDir: string, filePath: string): string {
  const base = baseDir.replace(/[\\/]+$/, '');
  const file = filePath.trim().replace(/^\.[\\/]/, '');
  if (!file) return base;
  if (isAbsoluteOrRemotePath(file)) return file;
  return `${base}/${file.replace(/\\/g, '/')}`;
}

/**
 * Resolve a file reference to full path using structured outputFiles first, then hints.
 */
export function resolveFileRefPath(
  filePath: string,
  hints: ToolWorkspaceHints,
  outputFiles: ReturnType<typeof parseToolOutputFiles>,
): string {
  const trimmed = filePath.trim();
  if (!trimmed || isAbsoluteOrRemotePath(trimmed)) return trimmed;

  const baseName = trimmed.split(/[\\/]/).pop()?.toLowerCase() || trimmed.toLowerCase();
  for (const ref of outputFiles) {
    const refBase = ref.path.split(/[\\/]/).pop()?.toLowerCase();
    if (ref.path === trimmed || refBase === baseName) {
      return ref.path;
    }
  }

  const base = workspaceBaseFromHints(hints);
  if (base) return joinWorkspacePath(base, trimmed);
  return trimmed;
}

/** [media attached: path (mime) | path] — path may contain spaces. */
export const MEDIA_ATTACHED_REGEX = /\[media attached:\s*([^(]+?)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;

/**
 * Enrich basename-only [media attached: ...] entries to full paths when runDir/cwd is known.
 */
export function enrichMediaAttachedText(text: string, hints: ToolWorkspaceHints): string {
  if (!text || !workspaceBaseFromHints(hints)) return text;
  const outputFiles = parseToolOutputFiles(
    text.trim().startsWith('{') ? tryParseJson(text) : text,
  );

  return text.replace(MEDIA_ATTACHED_REGEX, (match, rawPath: string, mime: string) => {
    const path = rawPath.trim();
    const resolved = resolveFileRefPath(path, hints, outputFiles);
    if (resolved === path) return match;
    return `[media attached: ${resolved} (${mime.trim()}) | ${resolved}]`;
  });
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return text;
  }
}

/** Enrich string array fields like files: ["report.html"]. */
export function enrichStringFileList(
  files: string[],
  hints: ToolWorkspaceHints,
  outputFiles: ReturnType<typeof parseToolOutputFiles>,
): string[] {
  return files.map((f) => resolveFileRefPath(f, hints, outputFiles));
}
