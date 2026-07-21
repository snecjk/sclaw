import { beforeEach, describe, expect, it, vi } from 'vitest';

const moveToWorkspaceMock = vi.fn();
const listCatalogSessionsMock = vi.fn();
const softDeleteCatalogSessionMock = vi.fn();
const findLatestByChannelMock = vi.fn();
const ensureProjectAgentMock = vi.fn();
const listProjectAgentIdsMock = vi.fn();
const deleteAllProjectAgentsForProjectMock = vi.fn();
const getByIdMock = vi.fn();
const createWorkspaceMock = vi.fn();
const updateWorkspaceMock = vi.fn();
const softDeleteWorkspaceMock = vi.fn();
const getDefaultWorkspaceMock = vi.fn();
const countActiveMock = vi.fn();
const getBySessionKeyMock = vi.fn();
const softDeleteBindingMock = vi.fn();
const ensureWorkspaceArtifactOutputDirMock = vi.fn();

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn().mockRejectedValue(new Error('missing registry')),
    mkdir: vi.fn(),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}));

vi.mock('../../electron/utils/paths', () => ({
  getClawXConfigDir: vi.fn(() => '/tmp'),
  ensureWorkspaceArtifactOutputDir: ensureWorkspaceArtifactOutputDirMock,
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../electron/db/repositories/catalog-session-repository', () => ({
  getCatalogSessionRepository: vi.fn(() => ({
    moveToWorkspace: moveToWorkspaceMock,
    list: listCatalogSessionsMock,
    softDelete: softDeleteCatalogSessionMock,
    findBySessionKey: vi.fn(),
    findLatestByChannel: findLatestByChannelMock,
    upsert: vi.fn(),
  })),
}));

vi.mock('../../electron/db/repositories/session-engine-binding-repository', () => ({
  getSessionEngineBindingRepository: vi.fn(() => ({
    countActive: countActiveMock,
    getBySessionKey: getBySessionKeyMock,
    softDelete: softDeleteBindingMock,
    upsert: vi.fn(),
  })),
}));

vi.mock('../../electron/db/repositories/session-group-repository', () => ({
  getSessionGroupRepository: vi.fn(() => ({
    getById: vi.fn(),
  })),
}));

vi.mock('../../electron/db/repositories/workspace-repository', () => ({
  getWorkspaceRepository: vi.fn(() => ({
    getDefaultWorkspace: getDefaultWorkspaceMock,
    getById: getByIdMock,
    create: createWorkspaceMock,
    update: updateWorkspaceMock,
    softDelete: softDeleteWorkspaceMock,
  })),
}));

vi.mock('../../electron/engines/session-engine', () => ({
  getAgentIdFromSessionKey: vi.fn(() => 'agent-main'),
}));

vi.mock('../../electron/engines/session-binding-map', () => ({
  bindingToRegistryEntry: vi.fn(),
}));

vi.mock('../../electron/utils/agent-config', () => ({
  getAgentWorkspacePath: vi.fn(),
}));

vi.mock('../../electron/services/project-agent-service', () => ({
  deleteAllProjectAgentsForProject: deleteAllProjectAgentsForProjectMock,
  ensureProjectAgent: ensureProjectAgentMock,
  listProjectAgentIds: listProjectAgentIdsMock,
}));

describe('session catalog gateway reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moveToWorkspaceMock.mockResolvedValue(undefined);
    listCatalogSessionsMock.mockResolvedValue([]);
    softDeleteCatalogSessionMock.mockResolvedValue(true);
    findLatestByChannelMock.mockResolvedValue(null);
    getDefaultWorkspaceMock.mockResolvedValue({ id: 'default' });
    countActiveMock.mockResolvedValue(1);
    getBySessionKeyMock.mockResolvedValue(null);
    softDeleteBindingMock.mockResolvedValue({});
    softDeleteWorkspaceMock.mockResolvedValue({});
    deleteAllProjectAgentsForProjectMock.mockResolvedValue([]);
    listProjectAgentIdsMock.mockResolvedValue([]);
    createWorkspaceMock.mockResolvedValue({ id: 'project-a', rootPath: '/tmp/project-a', name: 'A' });
    updateWorkspaceMock.mockResolvedValue({ id: 'project-a', rootPath: '/tmp/project-b', name: 'A' });
    getByIdMock.mockResolvedValue({ id: 'project-a', rootPath: '/tmp/project-a' });
  });

  it('gets the latest active channel session through the catalog repository', async () => {
    const latest = {
      workspaceId: 'default',
      sessionKey: 'agent:main:dingtalk:cid-1:20260719120000:a3f2',
      lastActivityAt: '2026-07-19T12:00:00.000Z',
    };
    findLatestByChannelMock.mockResolvedValue(latest);
    const { getLatestChannelCatalogSession } = await import(
      '../../electron/services/session-catalog-service'
    );

    await expect(getLatestChannelCatalogSession({
      channelType: 'dingtalk',
      channelId: 'cid-1',
      agentId: 'main',
    })).resolves.toEqual(latest);
    expect(findLatestByChannelMock).toHaveBeenCalledWith({
      channelType: 'dingtalk',
      channelId: 'cid-1',
      sessionKeyPrefix: 'agent:main:dingtalk:',
    });
  });

  it('creates a workspace without creating a project agent or reloading gateway', async () => {
    const gatewayManager = { debouncedReload: vi.fn(), reload: vi.fn() };
    const { createWorkspace } = await import('../../electron/services/session-catalog-service');

    const workspace = await createWorkspace(
      { name: 'A', rootPath: '/tmp/project-a' },
      gatewayManager as never,
    );

    expect(workspace).toEqual({ id: 'project-a', rootPath: '/tmp/project-a', name: 'A' });
    expect(ensureWorkspaceArtifactOutputDirMock).toHaveBeenCalledWith('/tmp/project-a');
    expect(ensureProjectAgentMock).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
    expect(gatewayManager.reload).not.toHaveBeenCalled();
  });

  it('ensures project agent when starting a chat in the project', async () => {
    ensureProjectAgentMock.mockResolvedValue({
      agentId: 'proj-project-a-main',
      created: true,
      workspaceUpdated: false,
    });
    const gatewayManager = { reload: vi.fn().mockResolvedValue(undefined) };
    const { ensureWorkspaceProjectAgent } = await import('../../electron/services/session-catalog-service');

    const result = await ensureWorkspaceProjectAgent('project-a', 'main', gatewayManager as never);

    expect(result).toEqual({
      agentId: 'proj-project-a-main',
      created: true,
      workspaceUpdated: false,
    });
    expect(ensureProjectAgentMock).toHaveBeenCalledWith('project-a', 'main', '/tmp/project-a');
    expect(gatewayManager.reload).toHaveBeenCalledWith({ force: true });
  });

  it('skips agent sync on path change when the project has no agents yet', async () => {
    const gatewayManager = { reload: vi.fn() };
    const { updateWorkspace } = await import('../../electron/services/session-catalog-service');

    await updateWorkspace('project-a', { rootPath: '/tmp/project-b' }, gatewayManager as never);

    expect(ensureProjectAgentMock).not.toHaveBeenCalled();
    expect(gatewayManager.reload).not.toHaveBeenCalled();
  });

  it('updates existing project agents when workspace path changes', async () => {
    listProjectAgentIdsMock.mockResolvedValue(['proj-project-a-main']);
    ensureProjectAgentMock.mockResolvedValue({
      agentId: 'proj-project-a-main',
      created: false,
      workspaceUpdated: true,
    });
    const gatewayManager = { reload: vi.fn().mockResolvedValue(undefined) };
    const { updateWorkspace } = await import('../../electron/services/session-catalog-service');

    await updateWorkspace('project-a', { rootPath: '/tmp/project-b' }, gatewayManager as never);

    expect(ensureProjectAgentMock).toHaveBeenCalledWith('project-a', 'main', '/tmp/project-b');
    expect(gatewayManager.reload).toHaveBeenCalledWith({ force: true });
  });

  it('skips reload when project agent already matches workspace', async () => {
    ensureProjectAgentMock.mockResolvedValue({
      agentId: 'proj-project-a-main',
      created: false,
      workspaceUpdated: false,
    });
    const gatewayManager = { debouncedReload: vi.fn() };
    const { bindSessionToWorkspace } = await import('../../electron/services/session-catalog-service');

    await bindSessionToWorkspace('agent:main:session-1', 'project-a', gatewayManager as never);

    expect(ensureProjectAgentMock).toHaveBeenCalledWith('project-a', 'agent-main', '/tmp/project-a');
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
  });

  it('awaits reload when bind creates a project agent so first send can route', async () => {
    ensureProjectAgentMock.mockResolvedValue({
      agentId: 'proj-project-a--main',
      created: true,
      workspaceUpdated: false,
    });
    let reloadCompleted = false;
    const gatewayManager = {
      reload: vi.fn(async () => {
        reloadCompleted = true;
      }),
    };
    const { bindSessionToWorkspace } = await import('../../electron/services/session-catalog-service');

    await bindSessionToWorkspace('agent:main:session-1', 'project-a', gatewayManager as never);

    expect(gatewayManager.reload).toHaveBeenCalledWith({ force: true });
    expect(reloadCompleted).toBe(true);
  });

  it('reloads when project agent is created during move', async () => {
    ensureProjectAgentMock.mockResolvedValue({
      agentId: 'proj-project-a-main',
      created: true,
      workspaceUpdated: false,
    });
    const gatewayManager = { debouncedReload: vi.fn() };
    const { moveSessionToWorkspace } = await import('../../electron/services/session-catalog-service');

    await moveSessionToWorkspace('agent:main:session-1', 'project-a', gatewayManager as never);

    expect(gatewayManager.debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('rejects moving sessions out of a project', async () => {
    const { moveSessionToWorkspace } = await import('../../electron/services/session-catalog-service');

    await expect(
      moveSessionToWorkspace('agent:main:session-1', 'default', { debouncedReload: vi.fn() } as never),
    ).rejects.toThrow('Moving sessions out of a project is not supported');
    expect(moveToWorkspaceMock).not.toHaveBeenCalled();
  });

  it('soft-deletes workspace sessions instead of moving them to recent', async () => {
    listCatalogSessionsMock.mockResolvedValue([
      { sessionKey: 'agent:main:session-1' },
      { sessionKey: 'agent:main:session-2' },
    ]);
    deleteAllProjectAgentsForProjectMock.mockResolvedValue(['proj-project-a-main']);
    const gatewayManager = { debouncedReload: vi.fn() };
    const { deleteWorkspace } = await import('../../electron/services/session-catalog-service');

    const result = await deleteWorkspace('project-a', gatewayManager as never);

    expect(result).toEqual({ deletedSessionCount: 2 });
    expect(softDeleteCatalogSessionMock).toHaveBeenNthCalledWith(1, 'project-a', 'agent:main:session-1');
    expect(softDeleteCatalogSessionMock).toHaveBeenNthCalledWith(2, 'project-a', 'agent:main:session-2');
    expect(softDeleteBindingMock).toHaveBeenNthCalledWith(1, 'agent:main:session-1');
    expect(softDeleteBindingMock).toHaveBeenNthCalledWith(2, 'agent:main:session-2');
    expect(moveToWorkspaceMock).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedReload).toHaveBeenCalledTimes(1);
  });
});
