import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalServiceManagerDialog } from '@/components/more-apps/ExternalServiceManagerDialog';

const pageMock = vi.fn();
const draftMock = vi.fn();
const saveMock = vi.fn();
const publishMock = vi.fn();

vi.mock('@/lib/external-service-api', () => ({
  pageExternalServicesAdmin: (...args: unknown[]) => pageMock(...args),
  getExternalServiceDraft: (...args: unknown[]) => draftMock(...args),
  saveExternalServiceDraft: (...args: unknown[]) => saveMock(...args),
  publishExternalService: (...args: unknown[]) => publishMock(...args),
  setExternalServiceStatus: vi.fn(),
}));

const draft = {
  schemaVersion: 'external-service/v1' as const,
  serviceId: 'sto-policy-ontology',
  latestVersion: '1.0.0',
  status: 'ACTIVE' as const,
  name: '策略本体服务',
  description: '策略查询',
  owner: 'policy-platform',
  environments: {
    daily: 'https://zc-hybrid-test.sto.cn/sto-policy/api',
    stage: 'https://zc-hybrid-stage.sto.cn/sto-policy/api',
    online: 'https://zc-hybrid.sto.cn/sto-policy/api',
  },
  auth: { type: 'stoToken' as const },
  integration: {},
};

describe('ExternalServiceManagerDialog', () => {
  beforeEach(() => {
    pageMock.mockResolvedValue({
      items: [{
        serviceId: draft.serviceId,
        name: draft.name,
        description: draft.description,
        owner: draft.owner,
        status: 'ACTIVE',
        latestVersion: '1.0.0',
        authType: 'stoToken',
        hasSdk: false,
        hasUsageGuide: false,
        updatedAt: '2026-08-27T00:00:00Z',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });
    draftMock.mockResolvedValue(draft);
    saveMock.mockResolvedValue(draft);
    publishMock.mockResolvedValue({ ...draft, version: '1.0.1' });
  });

  it('列出服务并允许编辑单份配置草稿', async () => {
    render(<ExternalServiceManagerDialog open onClose={vi.fn()} />);
    expect(await screen.findByText('策略本体服务')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(await screen.findByLabelText('Daily 地址')).toHaveValue(draft.environments.daily);
  });

  it('发布前必须二次确认', async () => {
    render(<ExternalServiceManagerDialog open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    fireEvent.click(await screen.findByRole('button', { name: '发布新版本' }));
    expect(screen.getByText('确认发布外部服务')).toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith(draft.serviceId));
  });
});
