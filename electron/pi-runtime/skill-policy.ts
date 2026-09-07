import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return absolute;
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/** Only admit skills contained by SClaw-owned roots passed from Main. */
export function isPiSkillPathAllowed(path: string, roots: string[]): boolean {
  if (!path.trim() || roots.length === 0) return false;
  const candidate = canonicalPath(path);
  return roots.some((root) => {
    const child = relative(canonicalPath(root), candidate);
    return child === '' || (!child.startsWith('..') && !isAbsolute(child));
  });
}

export function filterPiSkills<T extends { filePath?: string; baseDir?: string }>(
  skills: T[],
  roots: string[],
): T[] {
  return skills.filter((skill) => {
    const path = skill.filePath?.trim() || skill.baseDir?.trim();
    return path ? isPiSkillPathAllowed(path, roots) : false;
  });
}
