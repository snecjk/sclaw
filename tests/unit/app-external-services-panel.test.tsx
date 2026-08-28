import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppExternalServicesPanel } from '@/components/app-dev/AppExternalServicesPanel';

const searchMock = vi.fn();
const listMock = vi.fn();
const bindMock = vi.fn();
const removeMock = vi.fn();
const upgradeMock = vi.fn();

vi.mock('@/lib/app-dev-api', () => ({
  searchAppExternalServices: (...args: unknown[]) => searchMock(...args),
  listAppExternalServiceBindings: (...args: unknown[]) => listMock(...args),
  bindAppExternalService: (...args: unknown[]) => bindMock(...args),
  removeAppExternalService: (...args: unknown[]) => removeMock(...args),
  upgradeAppExternalService: (...args: unknown[]) => upgradeMock(...args),
}));

describe('AppExternalServicesPanel', () => {
  beforeEach(() => {
    listMock.mockResolvedValue([]);
    searchMock.mockResolvedValue({
      items: [{
        serviceId: 'sto-policy-ontology',
        name: '策略本体服务',
        description: '策略查询',
        owner: 'policy-platform',
        status: 'ACTIVE',
        latestVersion: '1.0.0',
        authType: 'stoToken',
        hasSdk: true,
        updatedAt: '2026-08-27T00:00:00Z',
      }], total: 1, pageNum: 1, pageSize: 20,
    });
    bindMock.mockResolvedValue({ changedFiles: [], installedPackage: null, usageGuide: null });
  });

  it('只把用户选择的服务绑定到当前工作区', async () => {
    render(<AppExternalServicesPanel workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText('搜索外部服务'), { target: { value: 'ontology' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('策略本体服务')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加到应用' }));
    await waitFor(() => expect(bindMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      serviceId: 'sto-policy-ontology',
      version: '1.0.0',
      alias: 'stoPolicyOntology',
    }));
  });
});
