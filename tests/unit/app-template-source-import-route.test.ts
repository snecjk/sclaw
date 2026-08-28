import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendJsonMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const statusMock = vi.fn();
const prepareMock = vi.fn();
const applyMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
}));
vi.mock('@electron/services/app-dev-service', () => ({
  openAppTemplateWorkspace: vi.fn(),
  publishAppTemplateWorkspace: vi.fn(),
}));
vi.mock('@electron/services/app-template-api-client', () => ({
  appTemplateApiClient: {},
}));
vi.mock('@electron/services/app-template-package-manager', () => ({
  listLocalBuiltinAppTemplates: vi.fn(),
}));
vi.mock('@electron/services/app-template-source-import-service', () => ({
  getAppTemplateImportStatus: (...args: unknown[]) => statusMock(...args),
  prepareAppTemplateSourceImport: (...args: unknown[]) => prepareMock(...args),
  applyAppTemplateSourceImport: (...args: unknown[]) => applyMock(...args),
  cancelAppTemplateSourceImport: (...args: unknown[]) => cancelMock(...args),
}));

describe('app template source import routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prepare forwards only workspace and source path', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      sourcePath: '/source/demo',
      targetPath: '/evil',
    });
    prepareMock.mockResolvedValueOnce({ importToken: 'token-1' });
    const { handleAppTemplateRoutes } = await import('@electron/api/routes/app-templates');

    const handled = await handleAppTemplateRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-templates/workspaces/import-source/prepare'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(prepareMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      sourcePath: '/source/demo',
    });
  });

  it('apply ignores renderer-provided file changes', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      importToken: 'token-1',
      changes: [{ path: '../evil', kind: 'add' }],
    });
    applyMock.mockResolvedValueOnce({ changedFiles: [] });
    const { handleAppTemplateRoutes } = await import('@electron/api/routes/app-templates');

    await handleAppTemplateRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-templates/workspaces/import-source/apply'),
      {} as never,
    );

    expect(applyMock).toHaveBeenCalledWith({ workspaceId: 'ws-1', importToken: 'token-1' });
  });

  it('serves status and cancel through the same workspace-scoped contract', async () => {
    statusMock.mockResolvedValueOnce({ hasSource: false, sourceAvailable: false });
    cancelMock.mockResolvedValueOnce({ cancelled: true });
    parseJsonBodyMock.mockResolvedValueOnce({ workspaceId: 'ws-1', importToken: 'token-1' });
    const { handleAppTemplateRoutes } = await import('@electron/api/routes/app-templates');

    await handleAppTemplateRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-templates/workspaces/import-source/status?workspaceId=ws-1'),
      {} as never,
    );
    await handleAppTemplateRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-templates/workspaces/import-source/cancel'),
      {} as never,
    );

    expect(statusMock).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
    expect(cancelMock).toHaveBeenCalledWith({ workspaceId: 'ws-1', importToken: 'token-1' });
  });
});
