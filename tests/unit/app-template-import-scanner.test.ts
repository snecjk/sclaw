import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  readTemplateImportState,
  writeTemplateImportState,
} from '../../electron/services/app-template-import-state';
import { scanTemplateSource } from '../../electron/services/app-template-import-scanner';
import {
  cleanupImportFixtureTrees,
  createImportFixtureTree,
} from './helpers/app-template-import-fixtures';

const snapshots: string[] = [];

afterEach(async () => {
  await cleanupImportFixtureTrees();
  await Promise.all(
    snapshots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function packageJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'demo',
    private: true,
    scripts: { dev: 'vite', build: 'vite build' },
    dependencies: { react: '^19.0.0' },
    devDependencies: { vite: '^5.4.0' },
    ...extra,
  });
}

async function createTarget(pageType: 'site' | 'assets' = 'site'): Promise<string> {
  return createImportFixtureTree('template-target-', {
    'manifest.json': JSON.stringify({
      schemaVersion: 1,
      templateId: `${pageType}-a`,
      pageType,
      name: '模板 A',
    }),
    'package.json': packageJson({
      dependencies: {
        react: '^19.0.0',
        '@sto/sclaw-plugin-sso-auth': '0.1.0',
      },
    }),
    'vite.config.ts': 'export default { build: { outDir: "build" } };',
    'src/main.tsx': 'platform main',
    'src/sclaw/bootstrap.ts': 'export async function bootstrapInstalledPlugins() {}',
    'src/App.tsx': 'old',
    'src/obsolete.ts': 'remove me',
  });
}

describe('scanTemplateSource', () => {
  it('建立来源快照并报告新增修改删除，但不修改模板', async () => {
    const target = await createTarget();
    await writeTemplateImportState(target, {
      schemaVersion: 1,
      sourcePath: '/previous/source',
      sourceFingerprint: 'old-hash',
      importedAt: '2026-08-28T00:00:00.000Z',
      files: { 'src/App.tsx': 'old', 'src/obsolete.ts': 'old' },
    });
    const source = await createImportFixtureTree('template-source-', {
      'package.json': packageJson(),
      'src/App.tsx': 'new',
      'src/New.tsx': 'new file',
      'src/main.tsx': 'source entry',
      'vite.config.ts': 'export default { server: { port: 4000 } };',
    });

    const prepared = await scanTemplateSource({
      templateRoot: target,
      sourcePath: source,
      pageType: 'site',
      managedPackages: ['@sto/sclaw-plugin-sso-auth'],
    });
    snapshots.push(prepared.snapshotRoot);

    expect(prepared.preview.changes).toEqual(expect.arrayContaining([
      { path: 'src/App.tsx', kind: 'modify' },
      { path: 'src/New.tsx', kind: 'add' },
      { path: 'src/obsolete.ts', kind: 'delete' },
      { path: 'src/main.source.tsx', kind: 'add' },
      { path: 'vite.config.source.ts', kind: 'add' },
    ]));
    expect(prepared.sourceEntry).toEqual({
      originalPath: 'src/main.tsx',
      stagedPath: 'src/main.source.tsx',
    });
    expect(prepared.sourceViteConfig).toEqual({
      originalPath: 'vite.config.ts',
      stagedPath: 'vite.config.source.ts',
      extension: 'ts',
    });
    expect(await readFile(join(target, 'src/App.tsx'), 'utf8')).toBe('old');
    expect(await readFile(join(prepared.snapshotRoot, 'src/App.tsx'), 'utf8')).toBe('new');
    expect(prepared.preview.issues).toContainEqual(expect.objectContaining({
      code: 'PAGE_TYPE_UNDECLARED',
      level: 'warning',
    }));
  });

  it('忽略敏感文件和平台文件且不读取其内容', async () => {
    const target = await createTarget();
    const source = await createImportFixtureTree('template-source-', {
      'package.json': packageJson(),
      '.env.daily': 'STO_TOKEN=never-return-this-value',
      '.sclaw/private.json': 'private',
      'src/main.tsx': 'source entry',
      'src/sclaw/bootstrap.ts': 'evil override',
    });

    const prepared = await scanTemplateSource({
      templateRoot: target,
      sourcePath: source,
      pageType: 'site',
    });
    snapshots.push(prepared.snapshotRoot);

    expect(prepared.preview.ignoredPaths).toEqual(expect.arrayContaining([
      '.env.daily',
      '.sclaw',
      'src/sclaw',
    ]));
    expect(JSON.stringify(prepared.preview)).not.toContain('never-return-this-value');
    expect(prepared.preview.issues).toContainEqual(expect.objectContaining({
      code: 'SENSITIVE_FILE_IGNORED',
      path: '.env.daily',
    }));
  });

  it('拒绝来源项目中的符号链接', async () => {
    const target = await createTarget();
    const source = await createImportFixtureTree('template-source-', {
      'package.json': packageJson(),
      'src/main.tsx': 'source entry',
    });
    await symlink('/tmp', join(source, 'outside-link'));

    await expect(scanTemplateSource({
      templateRoot: target,
      sourcePath: source,
      pageType: 'site',
    })).rejects.toThrow('来源项目不能包含符号链接');
  });

  it('来源明确声明相反 pageType 时阻断', async () => {
    const target = await createTarget('site');
    const source = await createImportFixtureTree('template-source-', {
      'manifest.json': JSON.stringify({ pageType: 'assets' }),
      'package.json': packageJson(),
      'src/main.tsx': 'source entry',
    });

    const prepared = await scanTemplateSource({
      templateRoot: target,
      sourcePath: source,
      pageType: 'site',
    });
    snapshots.push(prepared.snapshotRoot);
    expect(prepared.preview.issues).toContainEqual(expect.objectContaining({
      code: 'PAGE_TYPE_MISMATCH',
      level: 'blocker',
    }));
  });

  it('状态文件原子写入并能重新读取', async () => {
    const target = await createTarget();
    const state = {
      schemaVersion: 1 as const,
      sourcePath: '/source/demo',
      sourceFingerprint: 'hash',
      importedAt: '2026-08-28T00:00:00.000Z',
      files: { 'src/App.tsx': 'file-hash' },
    };
    await writeTemplateImportState(target, state);
    expect(await readTemplateImportState(target)).toEqual(state);
  });

  it('多个 Vite 配置会阻断而不是任意选一个', async () => {
    const target = await createTarget();
    const source = await createImportFixtureTree('template-source-', {
      'package.json': packageJson(),
      'src/main.tsx': 'source entry',
      'vite.config.ts': 'export default {}',
      'vite.config.mjs': 'export default {}',
    });

    const prepared = await scanTemplateSource({
      templateRoot: target,
      sourcePath: source,
      pageType: 'site',
    });
    snapshots.push(prepared.snapshotRoot);
    expect(prepared.preview.issues).toContainEqual(expect.objectContaining({
      code: 'VITE_CONFIG_UNRECOGNIZED',
      level: 'blocker',
    }));
  });

  it('将来源 HTML 的 main 入口改写到平台受管入口', async () => {
    const target = await createTarget();
    const source = await createImportFixtureTree('template-source-', {
      'package.json': packageJson(),
      'index.html': '<div id="root"></div><script type="module" src="./src/main.jsx"></script>',
      'src/main.jsx': 'source entry',
    });

    const prepared = await scanTemplateSource({
      templateRoot: target,
      sourcePath: source,
      pageType: 'site',
    });
    snapshots.push(prepared.snapshotRoot);

    expect(await readFile(join(prepared.snapshotRoot, 'index.html'), 'utf8'))
      .toContain('src="./src/main.tsx"');
  });
});
