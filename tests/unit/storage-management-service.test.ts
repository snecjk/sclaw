import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  root: '',
  workspaceRoot: '',
  trashItem: vi.fn(),
  openPath: vi.fn(),
  getById: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.root },
  shell: {
    trashItem: mocks.trashItem,
    openPath: mocks.openPath,
  },
}));

vi.mock('@electron/db/repositories/chat-runtime-repository', () => ({
  getChatRuntimeRepository: () => ({ listActive: vi.fn().mockResolvedValue([]) }),
}));

vi.mock('@electron/db/repositories/workflow-runtime-repository', () => ({
  getWorkflowRuntimeRepository: () => ({
    getRun: vi.fn().mockResolvedValue(null),
    listRunsByStatus: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('@electron/db/repositories/workspace-repository', () => ({
  getWorkspaceRepository: () => ({
    getById: mocks.getById,
    list: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('@electron/services/session-catalog-service', () => ({
  getSessionWorkspaceId: vi.fn().mockResolvedValue('default'),
}));

vi.mock('@electron/services/workflow-runtime/workspace-paths', () => ({
  workflowRuntimeWorkspacePath: () => join(mocks.root, 'workflow-runtime'),
}));

vi.mock('@electron/utils/paths', () => ({
  getDefaultAgentWorkspacePath: () => join(mocks.root, 'default-workspace'),
  getOpenClawConfigDir: () => join(mocks.root, 'openclaw'),
}));

vi.mock('@electron/utils/logger', () => ({ getLogFilePath: () => null }));

describe('StorageManagementService workspace artifacts', () => {
  beforeEach(async () => {
    mocks.root = await mkdtemp(join(tmpdir(), 'stoclaw-storage-test-'));
    mocks.workspaceRoot = join(mocks.root, 'project');
    await mkdir(mocks.workspaceRoot, { recursive: true });
    mocks.trashItem.mockReset().mockResolvedValue(undefined);
    mocks.openPath.mockReset().mockResolvedValue('');
    mocks.getById.mockReset().mockResolvedValue({ id: 'workspace-1', rootPath: mocks.workspaceRoot });
  });

  afterEach(async () => {
    await rm(mocks.root, { recursive: true, force: true });
  });

  it('moves only files older than seven local calendar days to Trash by default', async () => {
    const artifactRoot = join(mocks.workspaceRoot, '.sclaw', '.claw-output');
    const oldFile = join(artifactRoot, 'old.txt');
    const recentFile = join(artifactRoot, 'recent.txt');
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(oldFile, 'old');
    await writeFile(recentFile, 'recent');
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 8);
    await utimes(oldFile, oldDate, oldDate);

    const { StorageManagementService } = await import('@electron/services/storage-management-service');
    const result = await new StorageManagementService().cleanup(['workspace-artifacts:workspace-1'], { mode: 'trash' });

    expect(mocks.trashItem).toHaveBeenCalledTimes(1);
    expect(mocks.trashItem).toHaveBeenCalledWith(oldFile);
    expect(mocks.trashItem).not.toHaveBeenCalledWith(recentFile);
    expect(result.targets[0]).toMatchObject({ status: 'cleaned', matchedFileCount: 1, cleanedFileCount: 1 });
  });

  it('creates and opens only the canonical artifact directory resolved from the target id', async () => {
    const { StorageManagementService } = await import('@electron/services/storage-management-service');
    const service = new StorageManagementService();
    const result = await service.openWorkspaceArtifactsFolder('workspace-artifacts:workspace-1');
    const expected = join(mocks.workspaceRoot, '.sclaw', '.claw-output');

    expect(result).toEqual({ opened: true });
    expect((await stat(expected)).isDirectory()).toBe(true);
    expect(mocks.openPath).toHaveBeenCalledWith(expected);
    await expect(service.openWorkspaceArtifactsFolder('openclaw-history')).resolves.toEqual({
      opened: false,
      errorCode: 'TARGET_NOT_FOUND',
    });
  });

  it('permanently deletes matched artifacts without using the system Trash', async () => {
    const artifactRoot = join(mocks.workspaceRoot, '.sclaw', '.claw-output');
    const oldFile = join(artifactRoot, 'old.txt');
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(oldFile, 'old');
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 8);
    await utimes(oldFile, oldDate, oldDate);

    const { StorageManagementService } = await import('@electron/services/storage-management-service');
    const result = await new StorageManagementService().cleanup(
      ['workspace-artifacts:workspace-1'],
      { mode: 'delete' },
    );

    await expect(stat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mocks.trashItem).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'delete', movedToTrashBytes: 0, permanentlyDeletedBytes: 3 });
  });

  it('scans and cleans application caches separately from historical logs', async () => {
    const cacheDir = join(mocks.root, 'Cache');
    const logDir = join(mocks.root, 'logs');
    const logFile = join(logDir, 'stoclaw-2000-01-01.log');
    await mkdir(cacheDir, { recursive: true });
    await mkdir(logDir, { recursive: true });
    await writeFile(join(cacheDir, 'cache.bin'), 'cache');
    await writeFile(logFile, 'log');

    const { StorageManagementService } = await import('@electron/services/storage-management-service');
    const service = new StorageManagementService();
    const overview = await service.overview({ force: true });
    expect(overview.appCache).toMatchObject({ id: 'app-cache', bytes: 5, fileCount: 1 });
    expect(overview.appLogs).toMatchObject({ id: 'app-logs', bytes: 3, fileCount: 1 });

    await service.cleanup(['app-cache'], { mode: 'trash' });
    expect(mocks.trashItem).toHaveBeenCalledWith(cacheDir);
    expect(mocks.trashItem).not.toHaveBeenCalledWith(logFile);

    mocks.trashItem.mockClear();
    await service.cleanup(['app-logs'], { mode: 'trash' });
    expect(mocks.trashItem).toHaveBeenCalledWith(logFile);
    expect(mocks.trashItem).not.toHaveBeenCalledWith(cacheDir);
  });
});
