import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupSourceSnapshot,
  createSourceSnapshot,
  listSourceSnapshotFiles,
} from '../../electron/utils/code-source-archive';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sclaw-source-snapshot-'));
  roots.push(root);
  return root;
}

describe('source snapshot gitignore packing', () => {
  it('excludes node_modules, gitignored paths, and secret env files', async () => {
    const root = await makeWorkspace();
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, 'packages', 'web', 'node_modules', 'left'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, '.sto'), { recursive: true });
    await writeFile(join(root, '.gitignore'), [
      'node_modules/',
      'dist/',
      '*.log',
      '.DS_Store',
      '',
    ].join('\n'));
    await writeFile(join(root, 'package.json'), '{"name":"demo"}');
    await writeFile(join(root, 'src', 'main.tsx'), 'export default null\n');
    await writeFile(join(root, 'src', 'debug.log'), 'noise');
    await writeFile(join(root, 'dist', 'index.js'), 'built');
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'secret');
    await writeFile(join(root, 'packages', 'web', 'node_modules', 'left', 'index.js'), 'secret');
    await writeFile(join(root, '.env'), 'TOKEN=secret');
    await writeFile(join(root, '.env.local'), 'TOKEN=secret');
    await writeFile(join(root, '.env.example'), 'TOKEN=');
    await writeFile(join(root, '.git', 'config'), 'git');
    await writeFile(join(root, '.sto', 'workspace.json'), '{}');
    await mkdir(join(root, '.data'), { recursive: true });
    await writeFile(join(root, '.data', 'app.db'), 'sqlite-bytes');

    const files = await listSourceSnapshotFiles(root);
    expect(files).toEqual([
      '.env.example',
      '.gitignore',
      'package.json',
      'src/main.tsx',
    ]);
    expect(files.some((f) => f.startsWith('.data'))).toBe(false);

    const snapshot = await createSourceSnapshot(root);
    try {
      expect(snapshot.fileCount).toBe(4);
      expect(snapshot.archiveSizeBytes).toBeGreaterThan(0);
    } finally {
      await cleanupSourceSnapshot(snapshot);
    }
  });
});
