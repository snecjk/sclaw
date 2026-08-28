import { existsSync } from 'node:fs';
import { cp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/services/app-dev-service', () => ({
  createCheckpointWithStatus: vi.fn(),
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

import { buildAppTemplateArchive } from '../../electron/services/app-template-archive';
import { AppTemplateImportSessionStore } from '../../electron/services/app-template-import-session-store';
import { scanTemplateSource } from '../../electron/services/app-template-import-scanner';
import {
  readTemplateImportState,
  writeTemplateImportState,
} from '../../electron/services/app-template-import-state';
import {
  applyAppTemplateSourceImport,
  prepareAppTemplateSourceImport,
  type AppTemplateSourceImportDependencies,
} from '../../electron/services/app-template-source-import-service';
import {
  cleanupImportFixtureTrees,
  createImportFixtureTree,
} from './helpers/app-template-import-fixtures';

describe('app template source import integration', () => {
  const sessionStores: AppTemplateImportSessionStore[] = [];

  afterEach(async () => {
    await Promise.all(sessionStores.splice(0).map((store) => store.dispose()));
    await cleanupImportFixtureTrees();
  });

  it('imports and re-imports a Site project without leaking local state into its archive', async () => {
    const templateRoot = await createImportFixtureTree('template-integration-target-', {
      'manifest.json': JSON.stringify({
        schemaVersion: 1,
        templateId: 'site-a',
        pageType: 'site',
        name: 'Site A',
      }),
      'package.json': JSON.stringify({
        private: true,
        scripts: { dev: 'vite --host 127.0.0.1' },
        dependencies: { '@sto/sclaw-plugin-sso-auth': '0.1.0', react: '^19.0.0' },
        devDependencies: { vite: '^5.4.0' },
      }),
      'vite.config.ts': "// ssoAuthVite\nexport default { server: { port: 5173 } };",
      'src/main.tsx': 'platform main',
      'src/sclaw/bootstrap.ts': 'export async function bootstrapInstalledPlugins() {}',
      'src/App.tsx': 'old app',
    });
    const sourcePath = await createImportFixtureTree('template-integration-source-', {
      'package.json': JSON.stringify({
        scripts: { dev: 'vite' },
        dependencies: { react: '^19.0.0' },
        devDependencies: { vite: '^5.4.0' },
      }),
      'vite.config.ts': "import { defineConfig } from 'vite'; export default defineConfig({ base: '/demo/' });",
      'src/main.tsx': "import { createRoot } from 'react-dom/client'; createRoot(document.body).render(null);",
      'src/App.tsx': 'first app',
      'src/Old.tsx': 'remove me later',
    });
    const sessionStore = new AppTemplateImportSessionStore();
    sessionStores.push(sessionStore);
    const createCheckpoint = vi.fn().mockResolvedValue('created');
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const deps: AppTemplateSourceImportDependencies = {
      getWorkspaceRootPath: vi.fn().mockResolvedValue(templateRoot),
      readMarker: vi.fn().mockResolvedValue({
        kind: 'app-template',
        templateId: 'site-a',
        pageType: 'site',
        name: 'Site A',
        description: '',
        createdAt: '2026-08-28T00:00:00.000Z',
        updatedAt: '2026-08-28T00:00:00.000Z',
      }),
      readState: readTemplateImportState,
      scan: scanTemplateSource,
      listBindings: vi.fn().mockResolvedValue([]),
      isGitAvailable: vi.fn().mockResolvedValue(true),
      pathExists: existsSync,
      canonicalizePath: realpath,
      sessionStore,
      createCheckpoint,
      restartApp,
      copyFile: (source, destination) => cp(source, destination),
      writeState: writeTemplateImportState,
    };

    const firstPreview = await prepareAppTemplateSourceImport({
      workspaceId: 'ws-1',
      sourcePath,
    }, deps);
    expect(firstPreview.changes).toEqual(expect.arrayContaining([
      { path: 'src/App.tsx', kind: 'modify' },
      { path: 'src/Old.tsx', kind: 'add' },
    ]));
    const firstApply = await applyAppTemplateSourceImport({
      workspaceId: 'ws-1',
      importToken: firstPreview.importToken,
    }, deps);
    expect(firstApply.changedFiles).toContain('src/App.tsx');
    expect(await readFile(join(templateRoot, 'src/main.tsx'), 'utf8')).toContain('bootstrapInstalledPlugins');
    expect(await readFile(join(templateRoot, 'src/main.source.tsx'), 'utf8')).toContain('createRoot');
    expect(await readFile(join(templateRoot, 'vite.config.ts'), 'utf8')).toContain('mergeConfig');
    expect(await readFile(join(templateRoot, 'vite.config.sclaw.ts'), 'utf8')).toContain('ssoAuthVite');
    expect(await readFile(join(templateRoot, 'vite.config.source.ts'), 'utf8')).toContain('defineConfig');

    await writeFile(join(sourcePath, 'src/App.tsx'), 'second app', 'utf8');
    await rm(join(sourcePath, 'src/Old.tsx'));
    const secondPreview = await prepareAppTemplateSourceImport({ workspaceId: 'ws-1' }, deps);
    expect(secondPreview.changes).toContainEqual({ path: 'src/Old.tsx', kind: 'delete' });
    await applyAppTemplateSourceImport({
      workspaceId: 'ws-1',
      importToken: secondPreview.importToken,
    }, deps);
    expect(existsSync(join(templateRoot, 'src/Old.tsx'))).toBe(false);
    expect(await readFile(join(templateRoot, 'src/App.tsx'), 'utf8')).toBe('second app');
    expect(await readFile(join(templateRoot, 'src/sclaw/bootstrap.ts'), 'utf8')).toContain('bootstrapInstalledPlugins');
    expect(createCheckpoint).toHaveBeenCalledTimes(2);
    expect(restartApp).toHaveBeenCalledTimes(2);

    const archive = await JSZip.loadAsync(await buildAppTemplateArchive(templateRoot));
    expect(archive.file('.sclaw/local/template-source-import.json')).toBeNull();
    const archiveText = (await Promise.all(
      Object.values(archive.files)
        .filter((entry) => !entry.dir)
        .map((entry) => entry.async('string')),
    )).join('\n');
    expect(archiveText).not.toContain(sourcePath);
  });
});
