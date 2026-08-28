import { cp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/services/app-dev-service', () => ({
  createCheckpoint: vi.fn(),
  isGitAvailable: vi.fn(),
  readAppTemplateWorkspaceMarker: vi.fn(),
  restartApp: vi.fn(),
}));
vi.mock('../../electron/services/app-external-service-binding', () => ({
  listExternalServiceBindings: vi.fn(),
}));
vi.mock('../../electron/services/session-catalog-service', () => ({
  getWorkspaceRootPath: vi.fn(),
}));

import { AppTemplateImportSessionStore } from '../../electron/services/app-template-import-session-store';
import type { PreparedTemplateImport } from '../../electron/services/app-template-import-scanner';
import { scanTemplateSource } from '../../electron/services/app-template-import-scanner';
import { readTemplateImportState, writeTemplateImportState } from '../../electron/services/app-template-import-state';
import {
  applyAppTemplateSourceImport,
  cancelAppTemplateSourceImport,
  getAppTemplateImportStatus,
  prepareAppTemplateSourceImport,
  type AppTemplateSourceImportDependencies,
} from '../../electron/services/app-template-source-import-service';
import {
  cleanupImportFixtureTrees,
  createImportFixtureTree,
} from './helpers/app-template-import-fixtures';

function prepared(snapshotRoot = '/tmp/snapshot'): PreparedTemplateImport {
  return {
    snapshotRoot,
    sourcePath: '/source/demo',
    sourceFingerprint: 'fingerprint',
    importFiles: {},
    mergedPackageJson: {},
    preview: {
      sourceName: 'demo',
      detectedStack: 'react-vite',
      pageType: 'site',
      changes: [],
      ignoredPaths: [],
      packageChanges: [],
      issues: [],
    },
  };
}

describe('app template source import service', () => {
  const getWorkspaceRootPath = vi.fn();
  const readMarker = vi.fn();
  const readState = vi.fn();
  const scan = vi.fn();
  const listBindings = vi.fn();
  const isGitAvailable = vi.fn();
  const pathExists = vi.fn();
  const createCheckpoint = vi.fn();
  const restartApp = vi.fn();
  let sessionStore: AppTemplateImportSessionStore;
  let deps: AppTemplateSourceImportDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore = new AppTemplateImportSessionStore({ removeSnapshot: async () => undefined });
    deps = {
      getWorkspaceRootPath,
      readMarker,
      readState,
      scan,
      listBindings,
      isGitAvailable,
      pathExists,
      sessionStore,
      createCheckpoint,
      restartApp,
      copyFile: (source, destination) => cp(source, destination),
      writeState: writeTemplateImportState,
    };
    getWorkspaceRootPath.mockResolvedValue('/templates/site-a');
    readMarker.mockResolvedValue({
      kind: 'app-template',
      templateId: 'site-a',
      pageType: 'site',
      name: 'Site A',
      description: '',
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    });
    readState.mockResolvedValue({
      schemaVersion: 1,
      sourcePath: '/source/demo',
      sourceFingerprint: 'old',
      importedAt: '2026-08-28T00:00:00.000Z',
      files: {},
    });
    scan.mockResolvedValue(prepared());
    listBindings.mockResolvedValue([]);
    isGitAvailable.mockResolvedValue(true);
    pathExists.mockReturnValue(true);
    createCheckpoint.mockResolvedValue(true);
    restartApp.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await sessionStore.dispose();
    await cleanupImportFixtureTrees();
  });

  it('prepares only a template workspace and supports re-upload without a source path', async () => {
    const preview = await prepareAppTemplateSourceImport({ workspaceId: 'ws-1' }, deps);

    expect(scan).toHaveBeenCalledWith(expect.objectContaining({
      templateRoot: '/templates/site-a',
      sourcePath: '/source/demo',
      pageType: 'site',
      managedPackages: ['@sto/sclaw-plugin-sso-auth'],
    }));
    expect(preview.importToken).toBeTruthy();
    expect(preview.expiresAt).toBeTruthy();
  });

  it('does not expose the absolute source path in status', async () => {
    const status = await getAppTemplateImportStatus({ workspaceId: 'ws-1' }, deps);

    expect(status).toEqual({
      hasSource: true,
      sourceName: 'demo',
      sourceAvailable: true,
      lastImportedAt: '2026-08-28T00:00:00.000Z',
    });
    expect(status).not.toHaveProperty('sourcePath');
  });

  it('protects bound SDK packages and blocks applying without Git', async () => {
    listBindings.mockResolvedValue([
      { integration: { npmPackage: '@sto/sclaw-plugin-policy-ontology' } },
      { integration: { npmPackage: '@sto/sclaw-plugin-sso-auth' } },
    ]);
    isGitAvailable.mockResolvedValue(false);

    const preview = await prepareAppTemplateSourceImport({
      workspaceId: 'ws-1',
      sourcePath: '/source/demo',
    }, deps);

    expect(scan).toHaveBeenCalledWith(expect.objectContaining({
      managedPackages: [
        '@sto/sclaw-plugin-policy-ontology',
        '@sto/sclaw-plugin-sso-auth',
      ],
    }));
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: 'GIT_UNAVAILABLE',
      level: 'blocker',
    }));
  });

  it('rejects source paths that contain or are contained by the template root', async () => {
    await expect(prepareAppTemplateSourceImport({
      workspaceId: 'ws-1',
      sourcePath: '/templates',
    }, deps)).rejects.toMatchObject({ statusCode: 400 });

    await expect(prepareAppTemplateSourceImport({
      workspaceId: 'ws-1',
      sourcePath: '/templates/site-a/source',
    }, deps)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('cancels a prepared import for its workspace', async () => {
    const preview = await prepareAppTemplateSourceImport({ workspaceId: 'ws-1' }, deps);

    await expect(cancelAppTemplateSourceImport({
      workspaceId: 'ws-1',
      importToken: preview.importToken,
    }, deps)).resolves.toEqual({ cancelled: true });
  });

  it('creates a checkpoint, mirrors business files, and preserves template identity', async () => {
    const target = await createImportFixtureTree('template-target-', {
      'manifest.json': JSON.stringify({ schemaVersion: 1, templateId: 'site-a', pageType: 'site', name: '模板 A' }),
      'package.json': JSON.stringify({
        scripts: { dev: 'vite' },
        dependencies: { '@sto/sclaw-plugin-sso-auth': '0.1.0', react: '^19.0.0' },
        devDependencies: { vite: '^5.4.0' },
      }),
      'vite.config.ts': "import { defineConfig } from 'vite'; export default defineConfig({ build: { outDir: 'build' } });",
      'src/main.tsx': 'platform main',
      'src/sclaw/bootstrap.ts': 'export async function bootstrapInstalledPlugins() {}',
      'src/App.tsx': 'old',
      'src/obsolete.ts': 'old',
    });
    const source = await createImportFixtureTree('template-source-', {
      'package.json': JSON.stringify({
        dependencies: { react: '^19.0.0' },
        devDependencies: { vite: '^5.4.0' },
      }),
      'src/App.tsx': 'new',
      'src/main.tsx': 'source main',
    });
    await writeTemplateImportState(target, {
      schemaVersion: 1,
      sourcePath: source,
      sourceFingerprint: 'previous',
      importedAt: '2026-08-27T00:00:00.000Z',
      files: { 'src/App.tsx': 'old-hash', 'src/obsolete.ts': 'old-hash' },
    });
    const scanned = await scanTemplateSource({ templateRoot: target, sourcePath: source, pageType: 'site' });
    const created = sessionStore.create('ws-1', scanned);
    getWorkspaceRootPath.mockResolvedValue(target);

    const result = await applyAppTemplateSourceImport({
      workspaceId: 'ws-1',
      importToken: created.importToken,
    }, deps);

    expect(createCheckpoint).toHaveBeenCalledWith(target, '上传项目前自动保存');
    expect(await readFile(join(target, 'src/App.tsx'), 'utf8')).toBe('new');
    await expect(stat(join(target, 'src/obsolete.ts'))).rejects.toThrow();
    expect(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'))).toMatchObject({
      templateId: 'site-a',
      pageType: 'site',
      schemaVersion: 1,
    });
    expect(await readFile(join(target, 'vite.config.sclaw.ts'), 'utf8')).toContain('outDir');
    expect(await readFile(join(target, 'vite.config.ts'), 'utf8')).toContain('mergeConfig');
    expect(await readFile(join(target, 'src/main.tsx'), 'utf8')).toContain('bootstrapInstalledPlugins');
    expect(restartApp).toHaveBeenCalledWith('ws-1', target);
    expect(result.restartRequested).toBe(true);
    expect((await readTemplateImportState(target))?.sourcePath).toBe(source);
  });

  it('rolls back all files when copying the source snapshot fails', async () => {
    const target = await createImportFixtureTree('template-rollback-target-', {
      'manifest.json': JSON.stringify({ schemaVersion: 1, templateId: 'site-a', pageType: 'site' }),
      'package.json': JSON.stringify({
        scripts: { dev: 'vite' },
        dependencies: { react: '^19.0.0' },
        devDependencies: { vite: '^5.4.0' },
      }),
      'vite.config.ts': 'platform vite',
      'src/main.tsx': 'platform main',
      'src/App.tsx': 'old app',
      'src/obsolete.ts': 'old obsolete',
    });
    const source = await createImportFixtureTree('template-rollback-source-', {
      'package.json': JSON.stringify({
        dependencies: { react: '^19.0.0' },
        devDependencies: { vite: '^5.4.0' },
      }),
      'src/App.tsx': 'new app',
      'src/New.tsx': 'new file',
      'src/main.tsx': 'source main',
    });
    const oldState = {
      schemaVersion: 1 as const,
      sourcePath: source,
      sourceFingerprint: 'previous',
      importedAt: '2026-08-27T00:00:00.000Z',
      files: { 'src/App.tsx': 'old-hash', 'src/obsolete.ts': 'old-hash' },
    };
    await writeTemplateImportState(target, oldState);
    const scanned = await scanTemplateSource({ templateRoot: target, sourcePath: source, pageType: 'site' });
    const created = sessionStore.create('ws-1', scanned);
    getWorkspaceRootPath.mockResolvedValue(target);
    let sourceCopies = 0;
    deps.copyFile = async (from, to) => {
      if (from.startsWith(scanned.snapshotRoot)) {
        sourceCopies += 1;
        if (sourceCopies === 2) throw new Error('copy failed');
      }
      await cp(from, to);
    };

    await expect(applyAppTemplateSourceImport({
      workspaceId: 'ws-1',
      importToken: created.importToken,
    }, deps)).rejects.toThrow('copy failed');

    expect(await readFile(join(target, 'src/App.tsx'), 'utf8')).toBe('old app');
    expect(await readFile(join(target, 'src/obsolete.ts'), 'utf8')).toBe('old obsolete');
    await expect(stat(join(target, 'src/New.tsx'))).rejects.toThrow();
    expect(await readFile(join(target, 'vite.config.ts'), 'utf8')).toBe('platform vite');
    expect(await readTemplateImportState(target)).toEqual(oldState);
    expect(() => sessionStore.take(created.importToken, 'ws-1')).toThrow('导入会话不存在或已使用');
    expect(restartApp).not.toHaveBeenCalled();
  });
});
