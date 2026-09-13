import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  cleanup: vi.fn(),
  openWorkspaceArtifactsFolder: vi.fn(),
  hasActiveWork: vi.fn(),
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock('@electron/services/storage-management-service', () => ({
  storageManagementService: {
    overview: mocks.overview,
    cleanup: mocks.cleanup,
    openWorkspaceArtifactsFolder: mocks.openWorkspaceArtifactsFolder,
    hasActiveWork: mocks.hasActiveWork,
  },
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: mocks.parseJsonBody,
  sendJson: mocks.sendJson,
}));

function context(gatewayState = 'stopped') {
  return { gatewayManager: { getStatus: () => ({ state: gatewayState }) } } as never;
}

describe('storage routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defers a background scan while work is active', async () => {
    mocks.hasActiveWork.mockResolvedValue(true);
    const { handleStorageRoutes } = await import('@electron/api/routes/storage');
    const handled = await handleStorageRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://localhost/api/storage/overview?background=1'),
      context(),
    );
    expect(handled).toBe(true);
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 202, { deferred: true });
  });

  it('forces a refresh and passes the live OpenClaw state', async () => {
    mocks.overview.mockResolvedValue({ scannedAt: 'now' });
    const { handleStorageRoutes } = await import('@electron/api/routes/storage');
    await handleStorageRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/storage/refresh'),
      context('running'),
    );
    expect(mocks.overview).toHaveBeenCalledWith({ force: true, openClawInUse: true });
  });

  it('rejects arbitrary cleanup payloads and accepts whitelisted target ids', async () => {
    mocks.parseJsonBody.mockResolvedValueOnce({ targetIds: [], mode: 'trash' });
    const { handleStorageRoutes } = await import('@electron/api/routes/storage');
    await handleStorageRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/storage/cleanup'),
      context(),
    );
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 400, expect.anything());

    mocks.parseJsonBody.mockResolvedValueOnce({ targetIds: ['workflow-run:run-1'], mode: 'trash' });
    mocks.cleanup.mockResolvedValue({ movedToTrashBytes: 10, targets: [] });
    await handleStorageRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/storage/cleanup'),
      context(),
    );
    expect(mocks.cleanup).toHaveBeenCalledWith(['workflow-run:run-1'], { mode: 'trash', openClawInUse: false });
  });

  it('validates workspace retention policies', async () => {
    mocks.parseJsonBody.mockResolvedValueOnce({
      targetIds: ['workspace-artifacts:default'],
      mode: 'trash',
      policy: { kind: 'older-than', days: 8 },
    });
    const { handleStorageRoutes } = await import('@electron/api/routes/storage');
    await handleStorageRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/storage/cleanup'),
      context(),
    );
    expect(mocks.cleanup).not.toHaveBeenCalled();

    mocks.parseJsonBody.mockResolvedValueOnce({
      targetIds: ['workspace-artifacts:default'],
      mode: 'trash',
      policy: { kind: 'older-than', days: 7 },
    });
    mocks.cleanup.mockResolvedValue({ movedToTrashBytes: 0, targets: [] });
    await handleStorageRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/storage/cleanup'),
      context(),
    );
    expect(mocks.cleanup).toHaveBeenCalledWith(['workspace-artifacts:default'], {
      mode: 'trash',
      openClawInUse: false,
      policy: { kind: 'older-than', days: 7 },
    });
  });

  it('accepts explicit permanent deletion mode', async () => {
    mocks.parseJsonBody.mockResolvedValue({ targetIds: ['workspace-artifacts:default'], mode: 'delete' });
    mocks.cleanup.mockResolvedValue({ mode: 'delete', cleanedBytes: 0, targets: [] });
    const { handleStorageRoutes } = await import('@electron/api/routes/storage');
    await handleStorageRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/storage/cleanup'),
      context(),
    );
    expect(mocks.cleanup).toHaveBeenCalledWith(['workspace-artifacts:default'], {
      mode: 'delete',
      openClawInUse: false,
    });
  });

  it('opens only server-resolved storage targets', async () => {
    mocks.parseJsonBody.mockResolvedValue({ targetId: 'workspace-artifacts:default' });
    mocks.openWorkspaceArtifactsFolder.mockResolvedValue({ opened: true });
    const { handleStorageRoutes } = await import('@electron/api/routes/storage');
    await handleStorageRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/storage/open'),
      context(),
    );
    expect(mocks.openWorkspaceArtifactsFolder).toHaveBeenCalledWith('workspace-artifacts:default');
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 200, { opened: true });
  });
});
