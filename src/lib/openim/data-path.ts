/** Resolve OpenIM SDK data/log directories under Electron userData (per user). */
async function ensureOpenIMPaths(userID: string): Promise<{ dataDir: string; logDir: string }> {
  return window.electron.ipcRenderer.invoke('openim:ensureDirs', userID) as Promise<{
    dataDir: string;
    logDir: string;
  }>;
}

export async function getOpenIMDataDir(userID: string): Promise<string> {
  const paths = await ensureOpenIMPaths(userID);
  return paths.dataDir;
}

export async function getOpenIMLogDir(userID: string): Promise<string> {
  const paths = await ensureOpenIMPaths(userID);
  return paths.logDir;
}

export function getOpenIMPlatformID(): number {
  const platform = window.electron.platform;
  if (platform === 'darwin') return 4;
  if (platform === 'win32') return 3;
  if (platform === 'linux') return 7;
  return 5;
}
