import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { writeAppDevWorkspaceId } from '../../electron/services/app-dev-marker';

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it('把 workspaceId 写入 marker 且保留已有字段', async () => {
  root = await mkdtemp(join(tmpdir(), 'sclaw-marker-'));
  await mkdir(join(root, '.sclaw'));
  await writeFile(join(root, '.sclaw/app-dev.json'), JSON.stringify({
    kind: 'app-dev',
    name: 'Demo',
    projectType: 'frontend',
    createdAt: '2026-08-27T00:00:00.000Z',
    pageType: 'site',
  }));

  await writeAppDevWorkspaceId(root, 'ws-1');

  expect(JSON.parse(await readFile(join(root, '.sclaw/app-dev.json'), 'utf8'))).toMatchObject({
    workspaceId: 'ws-1',
    name: 'Demo',
    createdAt: '2026-08-27T00:00:00.000Z',
    pageType: 'site',
  });
});
