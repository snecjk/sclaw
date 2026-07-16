import { beforeEach, describe, expect, it, vi } from 'vitest';

const moveToWorkspaceMock = vi.fn();
const listCatalogSessionsMock = vi.fn();
const softDeleteCatalogSessionMock = vi.fn();
const ensureProjectAgentMock = vi.fn();
const deleteAllProjectAgentsForProjectMock = vi.fn();
const getByIdMock = vi.fn();
const softDeleteWorkspaceMock = vi.fn();
const getDefaultWorkspaceMock = vi.fn();
const countActiveMock = vi.fn();
const getBySessionKeyMock = vi.fn();
const softDeleteBindingMock = vi.fn();

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
}));

describe('session catalog gateway reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moveToWorkspaceMock.mockResolvedValue(undefined);
    listCatalogSessionsMock.mockResolvedValue([]);
    softDeleteCatalogSessionMock.mockResolvedValue(true);
    getDefaultWorkspaceMock.mockResolvedValue({ id: 'default' });
    countActiveMock.mockResolvedValue(1);
    getBySessionKeyMock.mockResolvedValue(null);
    softDeleteBindingMock.mockResolvedValue({});
    softDeleteWorkspaceMock.mockResolvedValue({});
    deleteAllProjectAgentsForProjectMock.mockResolvedValue([]);
    getByIdMock.mockResolvedValue({ id: 'project-a', rootPath: '/tmp/project-a' });
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
