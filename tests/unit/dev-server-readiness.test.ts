import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { probeDevServerReady } from '../../electron/services/dev-server-readiness';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test server address');
  return `http://127.0.0.1:${address.port}/`;
}

describe('probeDevServerReady', () => {
  it('resolves after the dev server responds', async () => {
    const url = await listen(createServer((_req, res) => {
      res.writeHead(200).end('ready');
    }));

    await expect(probeDevServerReady(url, new AbortController().signal)).resolves.toBeUndefined();
  });

  it('rejects immediately with cancellation while a readiness request is pending', async () => {
    const url = await listen(createServer(() => {
      // Keep the response open until the probe is canceled.
    }));
    const controller = new AbortController();
    const pending = probeDevServerReady(url, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'OperationCanceledError' });
  });
});
