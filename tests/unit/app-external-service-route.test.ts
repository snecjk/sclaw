import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendJsonMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const resolveAppPathMock = vi.fn().mockResolvedValue('/apps/demo');
const pageMock = vi.fn();
const listMock = vi.fn();
const bindMock = vi.fn();
const upgradeMock = vi.fn();
const removeMock = vi.fn();

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
}));
vi.mock('@electron/services/session-catalog-service', () => ({
  getWorkspaceRootPath: (...args: unknown[]) => resolveAppPathMock(...args),
}));
vi.mock('@electron/services/external-service-api-client', () => ({
  externalServiceApiClient: { page: (...args: unknown[]) => pageMock(...args) },
}));
vi.mock('@electron/services/app-external-service-binding', () => ({
  listExternalServiceBindings: (...args: unknown[]) => listMock(...args),
  bindExternalService: (...args: unknown[]) => bindMock(...args),
  upgradeExternalService: (...args: unknown[]) => upgradeMock(...args),
  removeExternalService: (...args: unknown[]) => removeMock(...args),
}));

describe('app external service routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bind 只接受可解析 workspaceId 并调用受控绑定服务', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      serviceId: 'sto-policy-ontology',
      version: '1.0.0',
      alias: 'policyOntology',
    });
    bindMock.mockResolvedValueOnce({ changedFiles: [] });
    const { handleAppExternalServiceRoutes } = await import(
      '@electron/api/routes/app-external-services'
    );

    const handled = await handleAppExternalServiceRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/app-external-services/bind'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(resolveAppPathMock).toHaveBeenCalledWith('ws-1');
    expect(bindMock).toHaveBeenCalledWith(expect.objectContaining({
      appPath: '/apps/demo',
      serviceId: 'sto-policy-ontology',
      alias: 'policyOntology',
    }));
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      changedFiles: [],
    });
  });

  it('search 未指定版本时只返回服务摘要', async () => {
    pageMock.mockResolvedValueOnce({ items: [{ serviceId: 'policy' }], total: 1 });
    const { handleAppExternalServiceRoutes } = await import(
      '@electron/api/routes/app-external-services'
    );

    await handleAppExternalServiceRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/app-external-services/search?workspaceId=ws-1&keyword=policy'),
      {} as never,
    );

    expect(resolveAppPathMock).toHaveBeenCalledWith('ws-1');
    expect(pageMock).toHaveBeenCalledWith({ keyword: 'policy', pageNum: 1, pageSize: 20 });
  });
});
