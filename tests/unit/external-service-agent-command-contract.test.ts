import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('external service agent command', () => {
  it('从 marker 读取 workspaceId 并只调用受控 Host API', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sclaw-services-command-'));
    roots.push(appPath);
    await mkdir(join(appPath, 'scripts'), { recursive: true });
    await mkdir(join(appPath, '.sclaw'), { recursive: true });
    await copyFile(
      join(process.cwd(), 'resources/app-templates/site-minimal/scripts/external-services.mjs'),
      join(appPath, 'scripts/external-services.mjs'),
    );
    await writeFile(join(appPath, '.sclaw/app-dev.json'), JSON.stringify({ workspaceId: 'ws-1' }));

    let received: { url?: string; body?: unknown } = {};
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received = {
        url: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, changedFiles: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address unavailable');

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [join(appPath, 'scripts/external-services.mjs'), 'bind', 'policy', '1.0.0', 'policyClient'],
        { env: { ...process.env, SCLAW_HOST_API_URL: `http://127.0.0.1:${address.port}` } },
      );
      expect(JSON.parse(stdout)).toMatchObject({ success: true });
      expect(received).toEqual({
        url: '/api/app-external-services/bind',
        body: {
          workspaceId: 'ws-1',
          serviceId: 'policy',
          version: '1.0.0',
          alias: 'policyClient',
        },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
