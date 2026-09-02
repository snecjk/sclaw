import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function patchAppDevMarker(
  appPath: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const markerPath = join(appPath, '.sclaw', 'app-dev.json');
  let marker: Record<string, unknown> = {};
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({ ...marker, ...patch }, null, 2)}\n`, 'utf8');
}

export async function writeAppDevWorkspaceId(appPath: string, workspaceIdRaw: string): Promise<void> {
  const workspaceId = workspaceIdRaw.trim();
  if (!workspaceId) throw new Error('workspaceId 不能为空');
  await patchAppDevMarker(appPath, { workspaceId });
}

/** Persist cloud appCode on first create so a later git/provision failure will not create a second app. */
export async function writeAppDevAppCode(appPath: string, appCodeRaw: string): Promise<void> {
  const appCode = appCodeRaw.trim();
  if (!appCode) throw new Error('appCode 不能为空');
  await patchAppDevMarker(appPath, { appCode });
}
