/**
 * Substitute {{token}} / {{hostname}} / {{serverUrl}} placeholders in auth argv.
 */
export function substituteAuthArgv(
  argv: string[],
  vars: { token?: string; hostname?: string; serverUrl?: string; [key: string]: string | undefined },
): string[] {
  return argv.map((part) =>
    part.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
      const value = vars[key];
      return value == null ? '' : value;
    }),
  );
}

export function hostnameFromServerUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl.includes('://') ? serverUrl : `https://${serverUrl}`);
    return u.hostname;
  } catch {
    return serverUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  }
}
