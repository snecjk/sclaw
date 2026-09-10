import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appDevMarkerPath,
  DEFAULT_APPS_PARENT_DIR,
  isAppDevSidebarHiddenRoot,
  listLocalOnlyDevApps,
} from '../../electron/services/app-dev-service';

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('isAppDevSidebarHiddenRoot', () => {
  it('does not hide an empty chat project that only has .sclaw/.claw-output', async () => {
    root = await mkdtemp(join(tmpdir(), 'sclaw-empty-project-'));
    await mkdir(join(root, '.sclaw', '.claw-output'), { recursive: true });

    expect(isAppDevSidebarHiddenRoot(root)).toBe(false);
  });

  it('hides a folder with .sclaw/app-dev.json', async () => {
    root = await mkdtemp(join(tmpdir(), 'sclaw-app-dev-marker-'));
    await mkdir(join(root, '.sclaw'), { recursive: true });
    await writeFile(appDevMarkerPath(root), JSON.stringify({
      kind: 'app-dev',
      name: 'Demo',
      projectType: 'frontend',
      createdAt: '2026-08-07T00:00:00.000Z',
    }));

    expect(isAppDevSidebarHiddenRoot(root)).toBe(true);
  });

  it('hides anything under ~/SClawApps even without a marker', () => {
    expect(isAppDevSidebarHiddenRoot(join(DEFAULT_APPS_PARENT_DIR, 'any-app'))).toBe(true);
  });
});

describe('listLocalOnlyDevApps vs empty chat project', () => {
  it('does not list a newly created chat project shell in 应用广场', async () => {
    root = await mkdtemp(join(tmpdir(), 'sclaw-empty-plaza-'));
    await mkdir(join(root, '.sclaw', '.claw-output'), { recursive: true });

    const apps = await listLocalOnlyDevApps({
      workspaces: [{
        id: 'ws-empty-chat',
        name: '0831002',
        rootPath: root,
      }],
      claimedWorkspaceIds: [],
      claimedPaths: [],
    });

    expect(apps).toEqual([]);
  });
});
