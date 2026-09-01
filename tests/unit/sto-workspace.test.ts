import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildStoWorkspaceFile,
  extractStoWorkspaceFields,
  isStoWorkspaceWritableStatus,
  mergeStoWorkspaceFields,
  parseStoWorkspaceFile,
  serializeStoWorkspaceFile,
} from '../../shared/sto-workspace';
import { writeStoWorkspaceBinding } from '../../electron/services/sto-workspace-store';

describe('sto workspace fields', () => {
  it('extracts create payload including nested data', () => {
    expect(extractStoWorkspaceFields({
      success: true,
      data: {
        appCode: 'app_xxx',
        status: 'ready',
        headCommitSha: 'deadbeef',
      },
    })).toEqual({
      appCode: 'app_xxx',
      status: 'ready',
      baseCommitSha: 'deadbeef',
    });
  });

  it('allows write when status is ready or missing, not failed/archived', () => {
    expect(isStoWorkspaceWritableStatus('ready')).toBe(true);
    expect(isStoWorkspaceWritableStatus(undefined)).toBe(true);
    expect(isStoWorkspaceWritableStatus('failed')).toBe(false);
    expect(isStoWorkspaceWritableStatus('archived')).toBe(false);
    expect(isStoWorkspaceWritableStatus('creating')).toBe(true);
    expect(isStoWorkspaceWritableStatus('draft')).toBe(true);
    expect(isStoWorkspaceWritableStatus('active')).toBe(true);
  });

  it('does not write failed apps and keeps first-create null baselines', () => {
    expect(buildStoWorkspaceFile({
      workspacePath: '/tmp/app',
      fields: { appCode: 'app_xxx', status: 'failed' },
    })).toBeNull();

    expect(buildStoWorkspaceFile({
      workspacePath: '/tmp/app',
      fields: {
        appCode: 'app_xxx',
        status: 'ready',
      },
    })).toEqual({
      version: 2,
      workspacePath: '/tmp/app',
      appCode: 'app_xxx',
      baseRevisionId: null,
      baseCommitSha: null,
      baseSourceSha256: null,
      mergeParentRevisionId: null,
    });
  });

  it('preserves existing baseline when new extract has no revision', () => {
    const existing = parseStoWorkspaceFile({
      version: 2,
      workspacePath: '/old/path',
      appCode: 'app_xxx',
      baseRevisionId: 'rev-1',
      baseCommitSha: 'abc123',
      baseSourceSha256: 'sha',
      mergeParentRevisionId: null,
    });
    expect(buildStoWorkspaceFile({
      workspacePath: '/new/path',
      fields: { appCode: 'app_xxx', status: 'ready' },
      existing,
    })?.baseRevisionId).toBe('rev-1');
  });

  it('lets clone payload fill gaps from cloud list without wiping revision', () => {
    const merged = mergeStoWorkspaceFields(
      { appCode: 'app_xxx' },
      {
        appCode: 'app_xxx',
        status: 'ready',
        baseRevisionId: 'rev-1',
        baseCommitSha: 'abc123',
      },
      extractStoWorkspaceFields({ appCode: 'app_xxx', status: 'ready' }),
    );
    expect(merged).toEqual({
      appCode: 'app_xxx',
      status: 'ready',
      baseRevisionId: 'rev-1',
      baseCommitSha: 'abc123',
    });
  });

  it('serializes only binding fields', () => {
    const text = serializeStoWorkspaceFile({
      version: 2,
      workspacePath: '/tmp/app',
      appCode: 'app_xxx',
      baseRevisionId: null,
      baseCommitSha: 'deadbeef',
      baseSourceSha256: null,
      mergeParentRevisionId: null,
    });
    expect(text).not.toContain('stoToken');
    expect(JSON.parse(text)).toMatchObject({
      appCode: 'app_xxx',
      baseRevisionId: null,
      mergeParentRevisionId: null,
    });
  });

  it('migrates legacy v1 workspace to v2 appCode', () => {
    const parsed = parseStoWorkspaceFile({
      version: 1,
      workspacePath: '/tmp/app',
      registryUrl: 'https://example.com',
      applicationId: 'app_legacy',
      applicationCode: 'app_legacy',
      baseRevisionId: 'rev-1',
      baseCommitSha: 'sha',
      baseSourceSha256: null,
      mergeParentRevisionId: null,
    });
    expect(parsed).toMatchObject({
      version: 2,
      appCode: 'app_legacy',
      baseRevisionId: 'rev-1',
    });
  });
});

describe('writeStoWorkspaceBinding', () => {
  it('writes .sto/workspace.json after create-like payload', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sto-workspace-'));
    const written = await writeStoWorkspaceBinding({
      appPath,
      payload: {
        data: {
          appCode: 'app_xxx',
          status: 'ready',
          headCommitSha: 'deadbeef',
        },
      },
    });
    expect(written?.appCode).toBe('app_xxx');
    expect(written?.baseRevisionId).toBeNull();
    expect(written?.baseCommitSha).toBe('deadbeef');

    const raw = JSON.parse(
      await readFile(join(appPath, '.sto', 'workspace.json'), 'utf8'),
    ) as { workspacePath: string; appCode: string };
    expect(raw.appCode).toBe('app_xxx');
    expect(raw.workspacePath).toBe(await realpath(appPath));
  });

  it('writes creating/draft apps so first-push retries can reuse appCode', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sto-workspace-creating-'));
    const written = await writeStoWorkspaceBinding({
      appPath,
      fallback: { appCode: 'app_creating', status: 'creating' },
    });
    expect(written?.appCode).toBe('app_creating');
  });

  it('skips failed status', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sto-workspace-failed-'));
    const written = await writeStoWorkspaceBinding({
      appPath,
      payload: { appCode: 'app_xxx', status: 'failed' },
    });
    expect(written).toBeNull();
    await expect(readFile(join(appPath, '.sto', 'workspace.json'), 'utf8')).rejects.toThrow();
  });

  it('fills clone gaps from cloud list and keeps existing baseline', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sto-workspace-clone-'));
    await mkdir(join(appPath, '.sto'));
    await writeFile(join(appPath, '.sto', 'workspace.json'), serializeStoWorkspaceFile({
      version: 2,
      workspacePath: appPath,
      appCode: 'app_xxx',
      baseRevisionId: 'rev-cli',
      baseCommitSha: 'sha-cli',
      baseSourceSha256: 'src-cli',
      mergeParentRevisionId: null,
    }), 'utf8');

    const written = await writeStoWorkspaceBinding({
      appPath,
      fallback: { appCode: 'app_xxx' },
      cloud: {
        appCode: 'app_xxx',
        status: 'ready',
      },
    });
    expect(written?.baseRevisionId).toBe('rev-cli');
    expect(written?.appCode).toBe('app_xxx');
  });
});
