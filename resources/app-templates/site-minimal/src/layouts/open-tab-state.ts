const HOME_PATH = 'home';

export function ensureOpenTab(openPaths: readonly string[], path: string): string[] {
  const normalized = openPaths.includes(HOME_PATH) ? [...openPaths] : [HOME_PATH, ...openPaths];
  return normalized.includes(path) ? normalized : [...normalized, path];
}

export function closeOpenTab(
  openPaths: readonly string[],
  closePath: string,
  activePath: string,
): { openPaths: string[]; nextPath: string } {
  const normalized = ensureOpenTab(openPaths, HOME_PATH);
  const index = normalized.indexOf(closePath);
  if (closePath === HOME_PATH || index < 0) {
    return { openPaths: normalized, nextPath: activePath };
  }

  const nextPaths = normalized.filter((path) => path !== closePath);
  if (activePath !== closePath) {
    return { openPaths: nextPaths, nextPath: activePath };
  }

  return {
    openPaths: nextPaths,
    nextPath: normalized[index + 1] ?? normalized[index - 1] ?? HOME_PATH,
  };
}
