import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  appDevMarkerPath,
  listLocalOnlyDevApps,
} from '../../electron/services/app-dev-service';

async function writeMarker(appPath: string, name: string): Promise<void> {
  await mkdir(join(appPath, '.sclaw'), { recursive: true });
  await writeFile(appDevMarkerPath(appPath), `${JSON.stringify({
    kind: 'app-dev',
    name,
    projectType: 'frontend',
    createdAt: '2026-08-23T00:00:00.000Z',
  }, null, 2)}\n`, 'utf8');
}

describe('listLocalOnlyDevApps', () => {
  it('includes imported local apps that are not claimed by a cloud row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-import-app-'));
    await writeMarker(root, '本地导入应用');

    const apps = await listLocalOnlyDevApps({
      workspaces: [{
        id: 'ws-imported',
        name: '本地导入应用',
        rootPath: root,
        createdAt: '2026-08-23T00:00:00.000Z',
      }],
      claimedWorkspaceIds: [],
      claimedPaths: [],
    });

    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      workspaceId: 'ws-imported',
      name: '本地导入应用',
      localReady: true,
      availability: 'local',
    });
    expect(apps[0].applicationId).toBeUndefined();
  });

  it('does not list a local folder already claimed by a cloud application', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-import-claimed-'));
    await writeMarker(root, '已绑定应用');

    const apps = await listLocalOnlyDevApps({
      workspaces: [{
        id: 'ws-claimed',
        name: '已绑定应用',
        rootPath: root,
      }],
      claimedWorkspaceIds: ['ws-claimed'],
      claimedPaths: [root],
    });

    expect(apps).toEqual([]);
  });
});
