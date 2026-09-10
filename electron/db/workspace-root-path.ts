import { resolve } from 'node:path';

/** Canonical absolute project folder path. Trailing slashes do not create a second workspace. */
export function normalizeWorkspaceRootPath(rootPath: string): string {
  const trimmed = rootPath.trim().replace(/[/\\]+$/, '');
  if (!trimmed) return '';
  return resolve(trimmed);
}
