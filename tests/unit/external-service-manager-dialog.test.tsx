import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalServiceManagerDialog } from '@/components/more-apps/ExternalServiceManagerDialog';

const pageMineMock = vi.fn();
const pageMarketMock = vi.fn();
const draftMock = vi.fn();
const saveMock = vi.fn();
const publishMock = vi.fn();
const marketDetailMock = vi.fn();

vi.mock('@/lib/external-service-api', () => ({
  pageMyExternalServices: (...args: unknown[]) => pageMineMock(...args),
  pageExternalServices: (...args: unknown[]) => pageMarketMock(...args),
  createMyExternalService: vi.fn(),
  getMyExternalServiceDraft: (...args: unknown[]) => draftMock(...args),
  getVisibleExternalServiceVersion: (...args: unknown[]) => marketDetailMock(...args),
  publishMyExternalService: (...args: unknown[]) => publishMock(...args),
  saveMyExternalServiceDraft: (...args: unknown[]) => saveMock(...args),
  setMyExternalServiceVisibility: vi.fn(),
}));

const mine = {
  serviceId: 'my-policy-service', serviceUid: 'service-mine', scopeType: 'COMPANY',
  companyCode: 'COMP001', visibility: 'PRIVATE', name: '我的策略服务', description: '',
  owner: 'owner', status: 'ACTIVE', latestVersion: null, authType: 'stoToken',
  hasSdk: false, hasUsageGuide: false, updatedAt: '2026-09-02T00:00:00Z',
};
const market = {
  serviceId: 'platform-policy-service', serviceUid: 'service-platform', scopeType: 'PLATFORM',
  companyCode: '__PLATFORM__', visibility: 'PUBLIC', name: '平台策略服务', description: '',
  owner: 'platform', status: 'ACTIVE', latestVersion: '1.0.0', authType: 'stoToken',
  hasSdk: false, hasUsageGuide: true, updatedAt: '2026-09-02T00:00:00Z',
};
const draft = {
  schemaVersion: 'external-service/v1' as const,
  serviceId: mine.serviceId,
  serviceUid: mine.serviceUid,
  scopeType: 'COMPANY' as const,
  companyCode: mine.companyCode,
  visibility: 'PRIVATE' as const,
  latestVersion: null,
  status: 'ACTIVE' as const,
  name: mine.name,
  description: mine.description,
  owner: mine.owner,
  environments: {
    daily: 'https://daily.sto.cn/policy',
    stage: 'https://stage.sto.cn/policy',
    online: 'https://online.sto.cn/policy',
  },
  auth: { type: 'stoToken' as const },
  integration: {},
};

describe('ExternalServiceManagerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageMineMock.mockResolvedValue({ items: [mine], total: 1, pageNum: 1, pageSize: 100 });
    pageMarketMock.mockResolvedValue({ items: [market], total: 1, pageNum: 1, pageSize: 100 });
    draftMock.mockResolvedValue(draft);
    saveMock.mockResolvedValue(draft);
    publishMock.mockResolvedValue({ ...draft, version: '1.0.0' });
    marketDetailMock.mockResolvedValue({
      ...draft,
      serviceId: market.serviceId,
      serviceUid: market.serviceUid,
      scopeType: market.scopeType,
      companyCode: market.companyCode,
      visibility: market.visibility,
      name: market.name,
      owner: market.owner,
      description: '平台策略服务详情',
      version: '1.0.0',
      integration: { usageGuide: '先查询列表，再按 ID 查询详情。' },
    });
  });

  it('separates editable personal services from the visible service marketplace', async () => {
    render(<ExternalServiceManagerDialog open onClose={vi.fn()} />);

    expect(await screen.findByText('我的策略服务')).toBeInTheDocument();
    expect(pageMineMock).toHaveBeenCalledWith({ pageSize: 100 });
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '服务广场' }));

    expect(await screen.findByText('平台策略服务')).toBeInTheDocument();
    await waitFor(() => expect(pageMarketMock).toHaveBeenCalledWith({ pageSize: 100 }));
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(await screen.findByText('平台策略服务详情')).toBeInTheDocument();
    expect(screen.getByText('先查询列表，再按 ID 查询详情。')).toBeInTheDocument();
    expect(marketDetailMock).toHaveBeenCalledWith(market.serviceUid, market.latestVersion);
  });

  it('keeps edit and publish confirmation available for an owned service', async () => {
    render(<ExternalServiceManagerDialog open onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect(await screen.findByLabelText('测试环境地址')).toHaveValue(draft.environments.daily);
    fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));

    expect(screen.getByText('确认发布外部服务')).toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith(mine.serviceUid));
  });

  it('filters the current view by service name or service id', async () => {
    pageMineMock.mockResolvedValueOnce({
      items: [mine, { ...mine, serviceId: 'status-service', serviceUid: 'service-status', name: '状态服务' }],
      total: 2, pageNum: 1, pageSize: 100,
    });
    render(<ExternalServiceManagerDialog open onClose={vi.fn()} />);
    expect(await screen.findByText('状态服务')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('搜索服务名称或外部服务编码'), {
      target: { value: 'policy' },
    });

    expect(screen.getByText('我的策略服务')).toBeInTheDocument();
    expect(screen.queryByText('状态服务')).not.toBeInTheDocument();
  });
});
