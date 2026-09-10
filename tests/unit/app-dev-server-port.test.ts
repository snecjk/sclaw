import { createServer, type Server } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { findAvailablePortMock } = vi.hoisted(() => ({
  findAvailablePortMock: vi.fn().mockResolvedValue(8802),
}));

vi.mock('electron', () => ({
  app: { on: vi.fn() },
}));

vi.mock('../../electron/utils/port-utils', () => ({
  findAvailablePort: findAvailablePortMock,
}));

import {
  allocateDevServerPort,
  buildDevServerNpmArgs,
} from '../../electron/services/app-dev-server-manager';

const servers: Server[] = [];
const tempDirs: string[] = [];

async function createAppPackage(packageJson: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sclaw-dev-server-'));
  tempDirs.push(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify(packageJson), 'utf8');
  return dir;
}

async function occupy(port: number): Promise<void> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('app dev server port allocation', () => {
  it('prefers port 8801 when it is available', async () => {
    await expect(allocateDevServerPort()).resolves.toBe(8801);
  });

  it('uses the next available port starting at 8801', async () => {
    await occupy(8801);

    await expect(allocateDevServerPort()).resolves.toBe(8802);
    expect(findAvailablePortMock).toHaveBeenCalledWith(8802);
  });
});

describe('app dev server command arguments', () => {
  it('omits the Vite-only strictPort option for Ice apps', async () => {
    const devDependencyApp = await createAppPackage({
      scripts: { dev: 'ice start' },
      devDependencies: { '@ice/app': '^3.6.5' },
    });
    const dependencyApp = await createAppPackage({
      dependencies: { '@ice/app': '^3.6.5' },
    });
    const scriptApp = await createAppPackage({ scripts: { dev: 'ice start' } });

    expect(buildDevServerNpmArgs(devDependencyApp, 8801)).toEqual([
      'run', 'dev', '--', '--port', '8801', '--host', '127.0.0.1',
    ]);
    expect(buildDevServerNpmArgs(dependencyApp, 8802)).toEqual([
      'run', 'dev', '--', '--port', '8802', '--host', '127.0.0.1',
    ]);
    expect(buildDevServerNpmArgs(scriptApp, 8803)).toEqual([
      'run', 'dev', '--', '--port', '8803', '--host', '127.0.0.1',
    ]);
  });

  it('keeps strictPort for Vite apps', async () => {
    const appPath = await createAppPackage({
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^5.4.0' },
    });

    expect(buildDevServerNpmArgs(appPath, 8801)).toEqual([
      'run', 'dev', '--', '--port', '8801', '--strictPort', '--host', '127.0.0.1',
    ]);
  });

  it('keeps the existing strictPort behavior when package metadata is unavailable', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sclaw-dev-server-'));
    tempDirs.push(appPath);

    expect(buildDevServerNpmArgs(appPath, 8801)).toEqual([
      'run', 'dev', '--', '--port', '8801', '--strictPort', '--host', '127.0.0.1',
    ]);
  });
});
