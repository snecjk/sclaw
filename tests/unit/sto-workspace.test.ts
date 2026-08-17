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
        applicationId: 'app_xxx',
        applicationUid: '01Kabc',
        applicationCode: 'test081115',
        status: 'ACTIVE',
        headCommitSha: 'deadbeef',
      },
    })).toEqual({
      applicationId: 'app_xxx',
      applicationUid: '01Kabc',
      applicationCode: 'test081115',
      status: 'ACTIVE',
      baseCommitSha: 'deadbeef',
    });
  });

  it('allows write when status is ACTIVE or missing, not FAILED', () => {
    expect(isStoWorkspaceWritableStatus('ACTIVE')).toBe(true);
    expect(isStoWorkspaceWritableStatus(undefined)).toBe(true);
    expect(isStoWorkspaceWritableStatus('FAILED')).toBe(false);
    expect(isStoWorkspaceWritableStatus('CREATING')).toBe(false);
  });

  it('does not write FAILED apps and keeps first-create null baselines', () => {
    expect(buildStoWorkspaceFile({
      workspacePath: '/tmp/app',
      registryUrl: 'https://zc-hybrid-test.sto.cn/',
      fields: { applicationId: 'app_xxx', status: 'FAILED' },
    })).toBeNull();

    expect(buildStoWorkspaceFile({
      workspacePath: '/tmp/app',
      registryUrl: 'https://zc-hybrid-test.sto.cn/',
      fields: {
        applicationId: 'app_xxx',
        applicationUid: '01Kabc',
        applicationCode: 'test081115',
        status: 'ACTIVE',
      },
    })).toEqual({
      version: 1,
      workspacePath: '/tmp/app',
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      applicationId: 'app_xxx',
      applicationUid: '01Kabc',
      applicationCode: 'test081115',
      baseRevisionId: null,
      baseCommitSha: null,
      baseSourceSha256: null,
      mergeParentRevisionId: null,
    });
  });

  it('preserves existing baseline when new extract has no revision', () => {
    const existing = parseStoWorkspaceFile({
      version: 1,
      workspacePath: '/old/path',
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      applicationId: 'app_xxx',
      applicationUid: '01Kabc',
      applicationCode: 'test081115',
      baseRevisionId: 'rev-1',
      baseCommitSha: 'abc123',
      baseSourceSha256: 'sha',
      mergeParentRevisionId: null,
    });
    expect(buildStoWorkspaceFile({
      workspacePath: '/new/path',
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      fields: { applicationId: 'app_xxx', status: 'ACTIVE' },
      existing,
    })?.baseRevisionId).toBe('rev-1');
  });

  it('lets clone payload fill gaps from cloud list without wiping revision', () => {
    const merged = mergeStoWorkspaceFields(
      { applicationId: 'app_xxx' },
      {
        applicationId: 'app_xxx',
        applicationCode: 'test081115',
        status: 'ACTIVE',
        baseRevisionId: 'rev-1',
        baseCommitSha: 'abc123',
      },
      extractStoWorkspaceFields({ applicationId: 'app_xxx', status: 'ACTIVE' }),
    );
    expect(merged).toEqual({
      applicationId: 'app_xxx',
      applicationCode: 'test081115',
      status: 'ACTIVE',
      baseRevisionId: 'rev-1',
      baseCommitSha: 'abc123',
    });
  });

  it('serializes only binding fields', () => {
    const text = serializeStoWorkspaceFile({
      version: 1,
      workspacePath: '/tmp/app',
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      applicationId: 'app_xxx',
      applicationUid: '01Kabc',
      applicationCode: 'test081115',
      baseRevisionId: null,
      baseCommitSha: 'deadbeef',
      baseSourceSha256: null,
      mergeParentRevisionId: null,
    });
    expect(text).not.toContain('stoToken');
    expect(JSON.parse(text)).toMatchObject({
      applicationId: 'app_xxx',
      baseRevisionId: null,
      mergeParentRevisionId: null,
    });
  });
});

describe('writeStoWorkspaceBinding', () => {
  it('writes .sto/workspace.json after create-like payload', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sto-workspace-'));
    const written = await writeStoWorkspaceBinding({
      appPath,
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      payload: {
        data: {
          applicationId: 'app_xxx',
          applicationUid: '01Kabc',
          applicationCode: 'test081115',
          status: 'ACTIVE',
          headCommitSha: 'deadbeef',
        },
      },
    });
    expect(written?.applicationId).toBe('app_xxx');
    expect(written?.baseRevisionId).toBeNull();
    expect(written?.baseCommitSha).toBe('deadbeef');

    const raw = JSON.parse(
      await readFile(join(appPath, '.sto', 'workspace.json'), 'utf8'),
    ) as { workspacePath: string; applicationId: string };
    expect(raw.applicationId).toBe('app_xxx');
    expect(raw.workspacePath).toBe(await realpath(appPath));
  });

  it('skips FAILED status', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sto-workspace-failed-'));
    const written = await writeStoWorkspaceBinding({
      appPath,
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      payload: { applicationId: 'app_xxx', status: 'FAILED' },
    });
    expect(written).toBeNull();
    await expect(readFile(join(appPath, '.sto', 'workspace.json'), 'utf8')).rejects.toThrow();
  });

  it('fills clone gaps from cloud list and keeps existing baseline', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sto-workspace-clone-'));
    await mkdir(join(appPath, '.sto'));
    await writeFile(join(appPath, '.sto', 'workspace.json'), serializeStoWorkspaceFile({
      version: 1,
      workspacePath: appPath,
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      applicationId: 'app_xxx',
      applicationUid: '01Kabc',
      applicationCode: 'test081115',
      baseRevisionId: 'rev-cli',
      baseCommitSha: 'sha-cli',
      baseSourceSha256: 'src-cli',
      mergeParentRevisionId: null,
    }), 'utf8');

    const written = await writeStoWorkspaceBinding({
      appPath,
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      fallback: { applicationId: 'app_xxx' },
      cloud: {
        applicationId: 'app_xxx',
        applicationCode: 'test081115',
        status: 'ACTIVE',
      },
    });
    expect(written?.baseRevisionId).toBe('rev-cli');
    expect(written?.applicationCode).toBe('test081115');
  });
});
