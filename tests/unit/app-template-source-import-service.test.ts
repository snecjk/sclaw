import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/services/app-dev-service', () => ({
  isGitAvailable: vi.fn(),
  readAppTemplateWorkspaceMarker: vi.fn(),
}));
vi.mock('../../electron/services/app-external-service-binding', () => ({
  listExternalServiceBindings: vi.fn(),
}));
vi.mock('../../electron/services/session-catalog-service', () => ({
  getWorkspaceRootPath: vi.fn(),
}));

import { AppTemplateImportSessionStore } from '../../electron/services/app-template-import-session-store';
import type { PreparedTemplateImport } from '../../electron/services/app-template-import-scanner';
import {
  cancelAppTemplateSourceImport,
  getAppTemplateImportStatus,
  prepareAppTemplateSourceImport,
  type AppTemplateSourceImportDependencies,
} from '../../electron/services/app-template-source-import-service';

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
  });

  afterEach(async () => {
    await sessionStore.dispose();
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
});
