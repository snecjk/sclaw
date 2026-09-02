import { access, mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { copyTemplate } from '../../electron/services/app-template-copy';

describe('copyTemplate', () => {
  it('does not copy template dependencies into a newly created app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-copy-template-'));
    const source = join(root, 'source');
    const destination = join(root, 'destination');
    await mkdir(join(source, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(source, 'package.json'), '{"name":"__APP_NAME__"}\n', 'utf8');
    await writeFile(join(source, 'node_modules', '.bin', 'vite'), 'template dependency', 'utf8');

    await copyTemplate(source, destination, {
      appName: 'new-app',
      appTitle: 'New App',
    });

    expect(await readFile(join(destination, 'package.json'), 'utf8')).toBe('{"name":"new-app"}\n');
    await expect(access(join(destination, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
