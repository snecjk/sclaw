import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { buildAppTemplateArchive } from '../../electron/services/app-template-archive';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('buildAppTemplateArchive', () => {
  it('生成根目录 ZIP 并排除敏感文件与构建产物', async () => {
    const root = await mkdtemp(join(tmpdir(), 'app-template-archive-test-'));
    roots.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'secret'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, '.sclaw'), { recursive: true });
    await mkdir(join(root, '.sclaw', 'local'), { recursive: true });
    await writeFile(join(root, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      templateId: 'site-minimal',
      pageType: 'site',
      name: '标准 Site 模版',
    }));
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'src', 'main.tsx'), 'export default null');
    await writeFile(join(root, '.env'), 'TOKEN=secret');
    await writeFile(join(root, '.env.secret'), 'TOKEN=secret');
    await writeFile(join(root, '.env.example'), 'TOKEN=');
    await writeFile(join(root, 'node_modules', 'secret', 'index.js'), 'secret');
    await writeFile(join(root, 'dist', 'index.js'), 'built');
    await writeFile(join(root, '.sclaw', 'app-template.json'), '{"local":true}');
    await writeFile(
      join(root, '.sclaw', 'local', 'template-source-import.json'),
      JSON.stringify({ sourcePath: '/Users/example/private/source-project' }),
    );

    const bytes = await buildAppTemplateArchive(root);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir);

    expect(names).toEqual([
      '.env.example',
      'manifest.json',
      'package.json',
      'src/main.tsx',
    ]);
    expect(zip.file('.env')).toBeNull();
    expect(zip.file('.env.secret')).toBeNull();
    expect(zip.file('.sclaw/app-template.json')).toBeNull();
    expect(zip.file('.sclaw/local/template-source-import.json')).toBeNull();
    const archiveText = await Promise.all(
      names.map(async (name) => zip.file(name)?.async('string') ?? ''),
    );
    expect(archiveText.join('\n')).not.toContain('/Users/example/private/source-project');
    expect(zip.file('site-minimal/manifest.json')).toBeNull();
  });
});
