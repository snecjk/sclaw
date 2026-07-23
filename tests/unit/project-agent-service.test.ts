import { beforeEach, describe, expect, it, vi } from 'vitest';

const listConfiguredAgentIdsMock = vi.fn();
const getAgentWorkspacePathMock = vi.fn();
const updateAgentWorkspaceMock = vi.fn();
const createAgentWithIdMock = vi.fn();
const getAgentEngineTypeMock = vi.fn();
const setAgentEngineTypeMock = vi.fn();
const ensureWorkspaceArtifactOutputDirMock = vi.fn();

vi.mock('../../electron/utils/agent-config', () => ({
  createAgentWithId: createAgentWithIdMock,
  deleteAgentConfig: vi.fn(),
  getAgentWorkspacePath: getAgentWorkspacePathMock,
  listConfiguredAgentIds: listConfiguredAgentIdsMock,
  setAgentEngineType: setAgentEngineTypeMock,
  updateAgentWorkspace: updateAgentWorkspaceMock,
  getAgentEngineType: getAgentEngineTypeMock,
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../electron/db/repositories/workspace-repository', () => ({
  getWorkspaceRepository: vi.fn(() => ({
    getById: vi.fn(),
  })),
}));

vi.mock('../../electron/utils/paths', () => ({
  getOpenClawAgentSkillsDir: vi.fn(() => '/tmp/skills'),
  ensureWorkspaceArtifactOutputDir: ensureWorkspaceArtifactOutputDirMock,
}));

vi.mock('../../electron/services/project-agent-workspace', () => ({
  prepareProjectAgentWorkspace: vi.fn(async (rootPath: string) => {
    const root = rootPath.replace(/[/\\]+$/, '');
    return `${root}/.sclaw`;
  }),
}));

vi.mock('../../electron/utils/fs-retry', () => ({
  safeRemoveDir: vi.fn(),
}));

describe('ensureProjectAgent workspace comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listConfiguredAgentIdsMock.mockResolvedValue(['proj-project-a--main']);
    updateAgentWorkspaceMock.mockResolvedValue({});
  });

  it('does not update workspace when only trailing slash differs', async () => {
    getAgentWorkspacePathMock.mockResolvedValue('/tmp/project-a/.sclaw');
    const { ensureProjectAgent } = await import('../../electron/services/project-agent-service');

    const result = await ensureProjectAgent('project-a', 'main', '/tmp/project-a/');

    expect(result).toEqual({
      agentId: 'proj-project-a--main',
      created: false,
      workspaceUpdated: false,
    });
    expect(updateAgentWorkspaceMock).not.toHaveBeenCalled();
    expect(ensureWorkspaceArtifactOutputDirMock).toHaveBeenCalledWith('/tmp/project-a/.sclaw');
  });

  it('updates workspace when normalized paths differ', async () => {
    getAgentWorkspacePathMock.mockResolvedValue('/tmp/project-a/.sclaw');
    const { ensureProjectAgent } = await import('../../electron/services/project-agent-service');

    const result = await ensureProjectAgent('project-a', 'main', '/tmp/project-b');

    expect(result).toEqual({
      agentId: 'proj-project-a--main',
      created: false,
      workspaceUpdated: true,
    });
    expect(updateAgentWorkspaceMock).toHaveBeenCalledWith('proj-project-a--main', '/tmp/project-b/.sclaw');
    expect(ensureWorkspaceArtifactOutputDirMock).toHaveBeenCalledWith('/tmp/project-b/.sclaw');
  });

  it('dedupes concurrent ensure calls for the same project agent', async () => {
    listConfiguredAgentIdsMock.mockResolvedValue([]);
    createAgentWithIdMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {};
    });
    getAgentEngineTypeMock.mockResolvedValue('openclaw');
    setAgentEngineTypeMock.mockResolvedValue({});

    const { ensureProjectAgent } = await import('../../electron/services/project-agent-service');
    const [first, second] = await Promise.all([
      ensureProjectAgent('project-b', 'main', '/tmp/project-b'),
      ensureProjectAgent('project-b', 'main', '/tmp/project-b'),
    ]);

    expect(first).toEqual(second);
    expect(createAgentWithIdMock).toHaveBeenCalledTimes(1);
  });

  it('rechecks a concurrent ensure when the requested project path changed', async () => {
    let releaseCreate!: () => void;
    listConfiguredAgentIdsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['proj-project-c--main']);
    createAgentWithIdMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseCreate = resolve; });
      return {};
    });
    getAgentEngineTypeMock.mockResolvedValue('openclaw');
    setAgentEngineTypeMock.mockResolvedValue({});
    getAgentWorkspacePathMock.mockResolvedValue('/tmp/project-c-old/.sclaw');

    const { ensureProjectAgent } = await import('../../electron/services/project-agent-service');
    const first = ensureProjectAgent('project-c', 'main', '/tmp/project-c-old');
    await vi.waitFor(() => {
      expect(typeof releaseCreate).toBe('function');
    });
    const second = ensureProjectAgent('project-c', 'main', '/tmp/project-c-new');
    releaseCreate();

    await expect(first).resolves.toMatchObject({ created: true });
    await expect(second).resolves.toMatchObject({ created: false, workspaceUpdated: true });
    expect(createAgentWithIdMock).toHaveBeenCalledTimes(1);
    expect(updateAgentWorkspaceMock).toHaveBeenCalledWith(
      'proj-project-c--main',
      '/tmp/project-c-new/.sclaw',
    );
  });
});
