import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function writeAppDevWorkspaceId(appPath: string, workspaceIdRaw: string): Promise<void> {
  const workspaceId = workspaceIdRaw.trim();
  if (!workspaceId) throw new Error('workspaceId 不能为空');
  const markerPath = join(appPath, '.sclaw', 'app-dev.json');
  let marker: Record<string, unknown> = {};
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({ ...marker, workspaceId }, null, 2)}\n`, 'utf8');
}
