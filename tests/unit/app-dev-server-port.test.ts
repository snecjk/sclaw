import { createServer, type Server } from 'node:net';

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

import { allocateDevServerPort } from '../../electron/services/app-dev-server-manager';

const servers: Server[] = [];

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
