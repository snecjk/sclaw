import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Resolve symlinks for existing paths and the closest existing parent for new files. */
export async function canonicalPiToolPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    let cursor = absolute;
    while (dirname(cursor) !== cursor) {
      cursor = dirname(cursor);
      try {
        const existing = await realpath(cursor);
        return resolve(existing, relative(cursor, absolute));
      } catch {
        // Continue to the closest existing parent.
      }
    }
    return absolute;
  }
}

export async function isPiToolPathAllowed(path: string, roots: string[]): Promise<boolean> {
  const candidate = await canonicalPiToolPath(path);
  for (const root of roots) {
    const canonical = await canonicalPiToolPath(root);
    const child = relative(canonical, candidate);
    if (child === '' || (!child.startsWith('..') && !isAbsolute(child))) return true;
  }
  return false;
}

export function piBashViolatesScheduledPolicy(command: string, roots: string[]): boolean {
  if (/\b(?:sudo|shutdown|reboot|diskpart|format|mkfs|reg\s+delete)\b/i.test(command)) return true;
  if (/(?:^|[\s/\\])\.\.(?:[/\\]|\s|$)/.test(command)) return true;
  const absolutePaths = command.match(/[A-Za-z]:\\[^\s"']+|\/(?:Users|home|etc|var|root)\/[^\s"']*/g) ?? [];
  return absolutePaths.some((value) => !roots.some((root) => {
    const normalizedRoot = resolve(root).toLowerCase();
    const normalizedValue = resolve(value).toLowerCase();
    return normalizedValue === normalizedRoot || normalizedValue.startsWith(`${normalizedRoot}${sep}`);
  }));
}
