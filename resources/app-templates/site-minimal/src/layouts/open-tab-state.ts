const HOME_PATH = 'home';

export function ensureOpenTab(
  openPaths: readonly string[],
  path: string,
  pinnedPath = HOME_PATH,
): string[] {
  const normalized = openPaths.includes(pinnedPath) ? [...openPaths] : [pinnedPath, ...openPaths];
  return normalized.includes(path) ? normalized : [...normalized, path];
}

export function closeOpenTab(
  openPaths: readonly string[],
  closePath: string,
  activePath: string,
  pinnedPath = HOME_PATH,
): { openPaths: string[]; nextPath: string } {
  const normalized = ensureOpenTab(openPaths, pinnedPath, pinnedPath);
  const index = normalized.indexOf(closePath);
  if (closePath === pinnedPath || index < 0) {
    return { openPaths: normalized, nextPath: activePath };
  }

  const nextPaths = normalized.filter((path) => path !== closePath);
  if (activePath !== closePath) {
    return { openPaths: nextPaths, nextPath: activePath };
  }

  return {
    openPaths: nextPaths,
    nextPath: normalized[index + 1] ?? normalized[index - 1] ?? pinnedPath,
  };
}
