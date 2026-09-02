import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertBuiltinTemplateDebugModeAllowed,
  assertTemplateWorkspaceCanPublish,
  resolveAppTemplateWorkspacePath,
  fingerprintBuiltinTemplateTree,
  initializeBuiltinTemplateDebugWorkspace,
  inspectBuiltinTemplateDebugWorkspace,
  resetBuiltinTemplateDebugWorkspace,
  syncBuiltinTemplateDebugWorkspace,
} from '../../electron/services/app-template-builtin-debug-service';

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sclaw-builtin-debug-'));
  roots.push(root);
  const resourcesRoot = join(root, 'resources');
  const sourceRoot = join(resourcesRoot, 'site-minimal');
  const workspaceRoot = join(root, 'workspace');
  await mkdir(join(sourceRoot, 'src'), { recursive: true });
  await mkdir(join(workspaceRoot, 'src'), { recursive: true });
  await writeFile(join(sourceRoot, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    templateId: 'site-minimal',
    pageType: 'site',
    name: '标准 Site 模版',
  }));
  await writeFile(join(sourceRoot, 'package.json'), '{"scripts":{"dev":"vite"}}');
  await writeFile(join(sourceRoot, 'src', 'App.tsx'), 'source');
  await writeFile(join(workspaceRoot, 'manifest.json'), await readFile(join(sourceRoot, 'manifest.json')));
  await writeFile(join(workspaceRoot, 'package.json'), await readFile(join(sourceRoot, 'package.json')));
  await writeFile(join(workspaceRoot, 'src', 'App.tsx'), 'workspace');
  await mkdir(join(workspaceRoot, '.sclaw'), { recursive: true });
  const sourceFingerprint = await fingerprintBuiltinTemplateTree(sourceRoot);
  await writeFile(join(workspaceRoot, '.sclaw', 'app-template.json'), JSON.stringify({
    kind: 'app-template',
    templateId: 'site-minimal',
    pageType: 'site',
    name: '标准 Site 模版',
    description: '',
    source: 'local-resource',
    sourceFingerprint,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
  }));
  return { resourcesRoot, sourceRoot, workspaceRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('built-in app template debug service', () => {
  it('rejects local debug and publishing boundaries outside their allowed mode', () => {
    expect(() => assertBuiltinTemplateDebugModeAllowed(true)).toThrow('只在 SClaw 开发模式可用');
    expect(() => assertTemplateWorkspaceCanPublish('local-resource'))
      .toThrow('本地内置模板调试工作区不能发布');
    expect(() => assertTemplateWorkspaceCanPublish('memory-center')).not.toThrow();
  });

  it('isolates a local debug workspace from the Memory Center template workspace', () => {
    expect(resolveAppTemplateWorkspacePath('/templates', 'site-minimal', 'local-resource'))
      .toBe(join('/templates', '.builtin-debug', 'site-minimal'));
    expect(resolveAppTemplateWorkspacePath('/templates', 'site-minimal', 'memory-center'))
      .toBe(join('/templates', 'site-minimal'));
  });

  it('initializes a debug workspace without copying generated or sensitive files', async () => {
    const { sourceRoot } = await fixture();
    const debugRoot = join(sourceRoot, '..', 'debug-copy');
    await mkdir(join(sourceRoot, 'build'), { recursive: true });
    await writeFile(join(sourceRoot, 'build', 'index.js'), 'generated');
    await writeFile(join(sourceRoot, '.npmrc'), '//registry/:_authToken=secret');
    await writeFile(join(sourceRoot, '.git'), 'gitdir: /tmp/original-worktree');
    await writeFile(join(sourceRoot, '.sclaw'), 'workspace-metadata');
    await writeFile(join(sourceRoot, 'package-lock.json'), '{"generated":true}');
    await writeFile(join(sourceRoot, 'tsconfig.tsbuildinfo'), 'generated');

    await initializeBuiltinTemplateDebugWorkspace(sourceRoot, debugRoot);

    expect(await readFile(join(debugRoot, 'src', 'App.tsx'), 'utf8')).toBe('source');
    await expect(readFile(join(debugRoot, 'build', 'index.js'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(debugRoot, '.npmrc'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(debugRoot, '.git'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(debugRoot, '.sclaw'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(debugRoot, 'package-lock.json'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(debugRoot, 'tsconfig.tsbuildinfo'), 'utf8')).rejects.toThrow();

    const safeDebugRoot = join(sourceRoot, '..', 'safe-debug-copy');
    await writeFile(join(sourceRoot, '.npmrc'), 'registry=http://snpm-registry.sto.cn\n');
    await initializeBuiltinTemplateDebugWorkspace(sourceRoot, safeDebugRoot);
    expect(await readFile(join(safeDebugRoot, '.npmrc'), 'utf8'))
      .toBe('registry=http://snpm-registry.sto.cn\n');
  });

  it('reports distributable file differences and ignores generated files', async () => {
    const { resourcesRoot, workspaceRoot } = await fixture();
    await mkdir(join(workspaceRoot, 'build'), { recursive: true });
    await writeFile(join(workspaceRoot, 'build', 'index.js'), 'generated');
    await writeFile(join(workspaceRoot, '.npmrc'), '//registry/:_authToken=secret');
    await writeFile(join(workspaceRoot, 'package-lock.json'), '{"generated":true}');
    await writeFile(join(workspaceRoot, 'tsconfig.tsbuildinfo'), 'generated');

    const status = await inspectBuiltinTemplateDebugWorkspace({ workspaceRoot, resourcesRoot });

    expect(status).toMatchObject({
      isBuiltinDebug: true,
      templateId: 'site-minimal',
      sourceChanged: false,
    });
    expect(status.changes).toEqual([{ path: 'src/App.tsx', kind: 'modify' }]);
  });

  it('blocks syncing when the resources template changed after the debug workspace was created', async () => {
    const { resourcesRoot, sourceRoot, workspaceRoot } = await fixture();
    await writeFile(join(sourceRoot, 'src', 'App.tsx'), 'changed outside');

    await expect(syncBuiltinTemplateDebugWorkspace({ workspaceRoot, resourcesRoot }))
      .rejects.toThrow('内置模板源码已发生变化');
  });

  it('blocks syncing when the source baseline is missing', async () => {
    const { resourcesRoot, workspaceRoot } = await fixture();
    const markerPath = join(workspaceRoot, '.sclaw', 'app-template.json');
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    delete marker.sourceFingerprint;
    await writeFile(markerPath, JSON.stringify(marker));

    await expect(syncBuiltinTemplateDebugWorkspace({ workspaceRoot, resourcesRoot }))
      .rejects.toThrow('缺少内置模板源码基线');
  });

  it('blocks syncing when template identity was changed in the debug workspace', async () => {
    const { resourcesRoot, workspaceRoot } = await fixture();
    await writeFile(join(workspaceRoot, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      templateId: 'other-template',
      pageType: 'site',
      name: '错误模板',
    }));

    await expect(syncBuiltinTemplateDebugWorkspace({ workspaceRoot, resourcesRoot }))
      .rejects.toThrow('manifest.json 与内置模板身份不一致');
  });

  it('syncs workspace files back to resources and removes stale distributable files', async () => {
    const { resourcesRoot, sourceRoot, workspaceRoot } = await fixture();
    await writeFile(join(sourceRoot, 'src', 'stale.ts'), 'stale');
    await writeFile(join(sourceRoot, '.env.local'), 'LOCAL_SECRET=keep');
    await writeFile(join(sourceRoot, '.npmrc'), '//registry/:_authToken=keep');
    await mkdir(join(sourceRoot, 'node_modules'), { recursive: true });
    await writeFile(join(sourceRoot, 'node_modules', 'keep.txt'), 'keep');
    const markerPath = join(workspaceRoot, '.sclaw', 'app-template.json');
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    marker.sourceFingerprint = await fingerprintBuiltinTemplateTree(sourceRoot);
    await writeFile(markerPath, JSON.stringify(marker));

    const result = await syncBuiltinTemplateDebugWorkspace({ workspaceRoot, resourcesRoot });

    expect(await readFile(join(sourceRoot, 'src', 'App.tsx'), 'utf8')).toBe('workspace');
    await expect(readFile(join(sourceRoot, 'src', 'stale.ts'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(sourceRoot, '.env.local'), 'utf8')).toBe('LOCAL_SECRET=keep');
    expect(await readFile(join(sourceRoot, '.npmrc'), 'utf8')).toBe('//registry/:_authToken=keep');
    expect(await readFile(join(sourceRoot, 'node_modules', 'keep.txt'), 'utf8')).toBe('keep');
    expect(result.changedFiles).toEqual(['src/App.tsx', 'src/stale.ts']);
  });

  it('reloads resources into the workspace while preserving local runtime directories', async () => {
    const { resourcesRoot, workspaceRoot } = await fixture();
    await mkdir(join(workspaceRoot, 'node_modules'), { recursive: true });
    await writeFile(join(workspaceRoot, 'node_modules', 'keep.txt'), 'keep');

    await resetBuiltinTemplateDebugWorkspace({ workspaceRoot, resourcesRoot });

    expect(await readFile(join(workspaceRoot, 'src', 'App.tsx'), 'utf8')).toBe('source');
    expect(await readFile(join(workspaceRoot, 'node_modules', 'keep.txt'), 'utf8')).toBe('keep');
    expect(JSON.parse(await readFile(join(workspaceRoot, '.sclaw', 'app-template.json'), 'utf8')))
      .toMatchObject({ source: 'local-resource', templateId: 'site-minimal' });
  });

  it('rejects overlapping mutations for the same debug workspace', async () => {
    const { resourcesRoot, workspaceRoot } = await fixture();

    const results = await Promise.allSettled([
      syncBuiltinTemplateDebugWorkspace({ workspaceRoot, resourcesRoot }),
      resetBuiltinTemplateDebugWorkspace({ workspaceRoot, resourcesRoot }),
    ]);

    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected'))
      .toMatchObject({ reason: expect.objectContaining({ message: expect.stringContaining('已有模板操作正在进行') }) });
  });
});
