import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendJsonMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const statusMock = vi.fn();
const prepareMock = vi.fn();
const applyMock = vi.fn();
const cancelMock = vi.fn();
const builtinStatusMock = vi.fn();
const builtinSyncMock = vi.fn();
const builtinResetMock = vi.fn();
const deleteTemplateMock = vi.fn();

vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
}));
vi.mock('@electron/api/internal-request-auth', () => ({
  assertInternalHostApiRequest: vi.fn(),
}));
vi.mock('@electron/services/app-dev-service', () => ({
  openAppTemplateWorkspace: vi.fn(),
  publishAppTemplateWorkspace: vi.fn(),
  getBuiltinAppTemplateDebugStatus: (...args: unknown[]) => builtinStatusMock(...args),
  syncBuiltinAppTemplateDebugWorkspace: (...args: unknown[]) => builtinSyncMock(...args),
  resetBuiltinAppTemplateDebugWorkspace: (...args: unknown[]) => builtinResetMock(...args),
}));
vi.mock('@electron/services/app-template-api-client', () => ({
  appTemplateApiClient: { delete: (...args: unknown[]) => deleteTemplateMock(...args) },
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

  it('删除模板转发到服务端并保留权限错误', async () => {
    const { handleAppTemplateRoutes } = await import('@electron/api/routes/app-templates');
    deleteTemplateMock.mockResolvedValueOnce({ templateId: 'custom', status: 'DISABLED' });
    const request = { method: 'DELETE' } as IncomingMessage;
    const response = {} as ServerResponse;
    const url = new URL('http://127.0.0.1/api/app-templates/custom');
    expect(await handleAppTemplateRoutes(request, response, url, {} as never)).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(response, 200, {
      success: true, templateId: 'custom', status: 'DISABLED',
    });
    expect(deleteTemplateMock).toHaveBeenCalledWith('custom');
    deleteTemplateMock.mockRejectedValueOnce(Object.assign(new Error('没有权限'), { statusCode: 403 }));
    await handleAppTemplateRoutes(request, response, url, {} as never);
    expect(sendJsonMock).toHaveBeenLastCalledWith(response, 403, { success: false, error: '没有权限' });
  });

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

  it('returns 400 before invoking services when identifiers are missing', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({ workspaceId: 'ws-1' });
    const { handleAppTemplateRoutes } = await import('@electron/api/routes/app-templates');

    await handleAppTemplateRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-templates/workspaces/import-source/apply'),
      {} as never,
    );

    expect(applyMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 400, expect.objectContaining({
      success: false,
    }));
  });

  it('serves built-in debug status and requires confirmation for sync or reload', async () => {
    builtinStatusMock.mockResolvedValueOnce({ isBuiltinDebug: true, changes: [] });
    builtinSyncMock.mockResolvedValueOnce({ changedFiles: ['src/App.tsx'] });
    builtinResetMock.mockResolvedValueOnce({ changedFiles: ['src/App.tsx'] });
    parseJsonBodyMock
      .mockResolvedValueOnce({ workspaceId: 'ws-1', confirmed: true })
      .mockResolvedValueOnce({ workspaceId: 'ws-1', confirmed: true });
    const { handleAppTemplateRoutes } = await import('@electron/api/routes/app-templates');

    await handleAppTemplateRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-templates/workspaces/builtin-debug/status?workspaceId=ws-1'),
      {} as never,
    );
    await handleAppTemplateRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-templates/workspaces/builtin-debug/sync'),
      {} as never,
    );
    await handleAppTemplateRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-templates/workspaces/builtin-debug/reset'),
      {} as never,
    );

    expect(builtinStatusMock).toHaveBeenCalledWith('ws-1');
    expect(builtinSyncMock).toHaveBeenCalledWith('ws-1');
    expect(builtinResetMock).toHaveBeenCalledWith('ws-1');
  });
});
