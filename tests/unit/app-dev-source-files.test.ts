import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  listAppSourceFiles,
  readAppSourceFile,
  writeAppSourceFile,
} from '../../electron/services/app-dev-service';

describe('app-dev source file APIs', () => {
  it('lists editable sources and blocks path escape on write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-app-dev-'));
    await mkdir(join(root, 'frontend', 'src'), { recursive: true });
    await writeFile(join(root, 'frontend', 'src', 'App.tsx'), 'export default function App(){return null}', 'utf8');
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports=1', 'utf8');

    const files = await listAppSourceFiles(root);
    expect(files.some((f) => f.path === 'frontend/src/App.tsx')).toBe(true);
    expect(files.some((f) => f.path.includes('node_modules'))).toBe(false);

    const read = await readAppSourceFile(root, 'frontend/src/App.tsx');
    expect(read.content).toContain('export default');

    await writeAppSourceFile(root, 'frontend/src/App.tsx', 'export default function App(){return <div/>}');
    const again = await readAppSourceFile(root, 'frontend/src/App.tsx');
    expect(again.content).toContain('<div/>');

    await expect(writeAppSourceFile(root, '../outside.ts', 'nope')).rejects.toThrow(/非法|超出/);
  });
});
