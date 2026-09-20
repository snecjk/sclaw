import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appPath: '',
  getSiteApp: vi.fn(),
  updateSiteApp: vi.fn(),
  getBinding: vi.fn(),
}));

vi.mock('../../electron/services/session-catalog-service', () => ({
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  getWorkspaceRootPath: vi.fn(async () => mocks.appPath),
  listUserWorkspaces: vi.fn(async () => []),
}));

vi.mock('../../electron/services/site-app-api', () => ({
  archiveSiteApp: vi.fn(),
  enrichSiteAppRecord: vi.fn(),
  getSiteApp: (...args: unknown[]) => mocks.getSiteApp(...args),
  listSiteApps: vi.fn(async () => []),
  updateSiteApp: (...args: unknown[]) => mocks.updateSiteApp(...args),
}));

vi.mock('../../electron/services/sto-app-binding-store', () => ({
  getStoAppBindingByWorkspaceId: (...args: unknown[]) => mocks.getBinding(...args),
  listStoAppBindings: vi.fn(async () => []),
  removeStoAppBinding: vi.fn(),
  removeStoAppBindingByWorkspaceId: vi.fn(),
  upsertStoAppBinding: vi.fn(),
}));

import {
  appDevMarkerPath,
  getUserAppDescription,
  updateUserAppDescription,
  writeAppDevBootstrap,
} from '../../electron/services/app-dev-service';

async function writeMarker(description: string | undefined, appCode?: string): Promise<void> {
  await mkdir(join(mocks.appPath, '.sclaw'), { recursive: true });
  const marker: Record<string, unknown> = {
    kind: 'app-dev',
    name: '测试应用',
    projectType: 'frontend',
    createdAt: '2026-09-20T00:00:00.000Z',
  };
  if (description !== undefined) marker.description = description;
  if (appCode) marker.appCode = appCode;
  await writeFile(appDevMarkerPath(mocks.appPath), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

async function readDescription(): Promise<string | undefined> {
  const marker = JSON.parse(await readFile(appDevMarkerPath(mocks.appPath), 'utf8')) as {
    description?: string;
  };
  return marker.description;
}

describe('application description service', () => {
  beforeEach(async () => {
    mocks.appPath = await mkdtemp(join(tmpdir(), 'sclaw-app-description-'));
    mocks.getSiteApp.mockReset();
    mocks.updateSiteApp.mockReset();
    mocks.getBinding.mockReset();
    mocks.getBinding.mockResolvedValue(null);
  });

  it('saves an unbound description only to the local marker', async () => {
    await writeMarker('旧描述');

    await expect(updateUserAppDescription({
      workspaceId: 'ws-local',
      description: '  新描述  ',
    })).resolves.toEqual({ description: '新描述', bound: false });

    expect(await readDescription()).toBe('新描述');
    expect(mocks.updateSiteApp).not.toHaveBeenCalled();
  });

  it('preserves description when the app bootstrap is re-ensured', async () => {
    await writeMarker('需要保留的描述');

    await writeAppDevBootstrap(mocks.appPath, {
      name: '测试应用',
      projectType: 'frontend',
      pageType: 'site',
    });

    expect(await readDescription()).toBe('需要保留的描述');
  });

  it('updates a bound app remotely before refreshing its local cache', async () => {
    await writeMarker('旧描述', 'app-1');
    mocks.updateSiteApp.mockResolvedValue({ appCode: 'app-1', description: '远程标准描述' });

    await expect(updateUserAppDescription({
      workspaceId: 'ws-bound',
      description: '新描述',
    })).resolves.toEqual({ description: '远程标准描述', bound: true });

    expect(mocks.updateSiteApp).toHaveBeenCalledWith('app-1', { description: '新描述' });
    expect(await readDescription()).toBe('远程标准描述');
  });

  it('sends null when clearing a bound remote description', async () => {
    await writeMarker('旧描述', 'app-1');
    mocks.updateSiteApp.mockResolvedValue({ appCode: 'app-1', description: null });

    await expect(updateUserAppDescription({
      workspaceId: 'ws-bound',
      description: '   ',
    })).resolves.toEqual({ description: '', bound: true });

    expect(mocks.updateSiteApp).toHaveBeenCalledWith('app-1', { description: null });
    expect(await readDescription()).toBe('');
  });

  it('does not overwrite local cache when the remote update fails', async () => {
    await writeMarker('旧描述', 'app-1');
    mocks.updateSiteApp.mockRejectedValue(new Error('远程更新失败'));

    await expect(updateUserAppDescription({
      workspaceId: 'ws-bound',
      description: '未同步描述',
    })).rejects.toThrow('远程更新失败');

    expect(await readDescription()).toBe('旧描述');
  });

  it('returns stale local cache when a bound remote read fails', async () => {
    await writeMarker('缓存描述', 'app-1');
    mocks.getSiteApp.mockRejectedValue(new Error('网络不可用'));

    await expect(getUserAppDescription('ws-bound')).resolves.toEqual({
      description: '缓存描述',
      bound: true,
      source: 'local',
      stale: true,
    });
  });

  it('writes the remote description into local cache after a successful read', async () => {
    await writeMarker('旧缓存', 'app-1');
    mocks.getSiteApp.mockResolvedValue({ appCode: 'app-1', description: '远程描述' });

    await expect(getUserAppDescription('ws-bound')).resolves.toEqual({
      description: '远程描述',
      bound: true,
      source: 'remote',
    });
    expect(await readDescription()).toBe('远程描述');
  });
});
