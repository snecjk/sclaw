/**
 * Expand `<!-- include:shared/....md -->` markers in StoClaw context markdown.
 * Only paths under `contextRoot/shared/` are allowed.
 */
import { readFile } from 'fs/promises';
import { isAbsolute, normalize, relative, resolve, sep } from 'path';

const INCLUDE_LINE_RE = /^<!--\s*include:(shared\/[a-zA-Z0-9._/-]+\.md)\s*-->$/gm;

function assertSharedIncludePath(contextRoot: string, relPath: string): string {
  if (isAbsolute(relPath) || relPath.includes('..') || !relPath.startsWith('shared/')) {
    throw new Error(`include path escapes shared/: ${relPath}`);
  }

  const contextRootResolved = resolve(contextRoot);
  const sharedRoot = resolve(contextRootResolved, 'shared');
  const absolute = normalize(resolve(contextRootResolved, relPath));
  const relToShared = relative(sharedRoot, absolute);

  if (
    !absolute.startsWith(sharedRoot + sep)
    && absolute !== sharedRoot
  ) {
    throw new Error(`include path escapes shared/: ${relPath}`);
  }
  if (relToShared.startsWith('..') || isAbsolute(relToShared)) {
    throw new Error(`include path escapes shared/: ${relPath}`);
  }

  return absolute;
}

/**
 * Replace each include line with the corresponding shared fragment contents.
 */
export async function expandContextIncludes(
  raw: string,
  contextRoot: string,
): Promise<string> {
  const matches = [...raw.matchAll(INCLUDE_LINE_RE)];
  if (matches.length === 0) return raw;

  let result = raw;
  // Replace from last to first so indices stay valid.
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const full = match[0];
    const relPath = match[1];
    const index = match.index ?? -1;
    if (index < 0) continue;

    const absolute = assertSharedIncludePath(contextRoot, relPath);
    let fragment: string;
    try {
      fragment = await readFile(absolute, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to read include ${relPath}: ${message}`);
    }

    const replacement = `${fragment.trimEnd()}\n`;
    result = result.slice(0, index) + replacement + result.slice(index + full.length);
  }

  return result;
}
