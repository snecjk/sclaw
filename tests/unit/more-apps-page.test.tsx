import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchAppsMock = vi.fn();
const fetchCategoriesMock = vi.fn();
const fetchBannersMock = vi.fn();
const openInSclawBrowserMock = vi.fn();

vi.mock('@/lib/app-plaza-api', () => ({
  fetchAppPlazaApps: (...args: unknown[]) => fetchAppsMock(...args),
  fetchAppPlazaCategories: (...args: unknown[]) => fetchCategoriesMock(...args),
  fetchAppPlazaBanners: (...args: unknown[]) => fetchBannersMock(...args),
}));

vi.mock('@/lib/open-sclaw-browser', () => ({
  openInSclawBrowser: (...args: unknown[]) => openInSclawBrowserMock(...args),
}));

import { MoreAppsPage } from '@/components/more-apps/MoreAppsPage';
import { useMoreAppsStore } from '@/stores/more-apps';

const serverApp = {
  id: 'org-relation',
  name: '客户关系',
  description: '维护客户归属关系',
  url: 'https://example.com/org',
  iconKey: 'org-relation',
  tone: 'blue' as const,
  kind: 'builtin' as const,
};

function resetStore() {
  useMoreAppsStore.setState({
    activeTab: 'market',
    searchQuery: '',
    marketCategory: 'featured',
    heroSlideIndex: 0,
    userCode: '',
    banners: [],
    bannersLoading: false,
    bannersError: null,
    categories: [],
    categoriesLoading: false,
    categoriesError: null,
    apps: [],
    total: 0,
    pageNum: 0,
    loading: false,
    loadingMore: false,
    error: null,
    externalApps: [],
    installedIds: [],
    favoriteIds: [],
    addModalOpen: false,
    editingExternalAppId: null,
  });
}

describe('MoreAppsPage server catalog', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    openInSclawBrowserMock.mockReset();
    fetchBannersMock.mockReset().mockResolvedValue([]);
    fetchCategoriesMock.mockReset().mockResolvedValue([]);
    fetchAppsMock.mockReset().mockResolvedValue({
      items: [serverApp],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });
  });

  it('renders a whole-image URL banner and opens its configured link', async () => {
    fetchBannersMock.mockResolvedValueOnce([{
      id: 'campaign',
      title: '夏季活动',
      subtitle: '',
      imageUrl: 'https://cdn.example.com/campaign.png',
      targetType: 'URL',
      targetAppId: null,
      targetUrl: 'https://example.com/campaign',
      order: 1,
    }]);
    render(<MoreAppsPage />);
    const image = await screen.findByRole('img', { name: '夏季活动' });
    expect(image).toHaveAttribute('src', 'https://cdn.example.com/campaign.png');
    fireEvent.click(screen.getByRole('button', { name: '夏季活动' }));
    expect(openInSclawBrowserMock).toHaveBeenCalledWith({
      url: 'https://example.com/campaign',
      title: '夏季活动',
    });
  });

  it('does not make unresolved APP or NONE banners clickable', async () => {
    fetchBannersMock.mockResolvedValueOnce([
      {
        id: 'unknown-app',
        title: '未知应用',
        subtitle: '',
        imageUrl: 'https://cdn.example.com/unknown.png',
        targetType: 'APP',
        targetAppId: 'not-loaded',
        targetUrl: '',
        order: 1,
      },
      {
        id: 'display-only',
        title: '仅展示',
        subtitle: '',
        imageUrl: 'https://cdn.example.com/display.png',
        targetType: 'NONE',
        targetAppId: null,
        targetUrl: '',
        order: 2,
      },
    ]);
    render(<MoreAppsPage />);
    await screen.findByRole('img', { name: '未知应用' });
    expect(screen.queryByRole('button', { name: '未知应用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '仅展示' })).not.toBeInTheDocument();
  });

  it('maps server categories and sends categoryCode when selected', async () => {
    fetchCategoriesMock.mockResolvedValueOnce([{ id: 'org', name: '组织管理', description: '', iconKey: '', iconUrl: '', order: 1 }]);
    render(<MoreAppsPage />);
    const category = await screen.findByRole('button', { name: '组织管理' });
    await act(async () => fireEvent.click(category));
    await waitFor(() => expect(fetchAppsMock).toHaveBeenLastCalledWith({
      pageNum: 1,
      pageSize: 20,
      keyword: undefined,
      categoryCode: 'org',
    }));
  });

  it('keeps the APP list available when banners fail', async () => {
    fetchBannersMock.mockRejectedValueOnce(new Error('banner unavailable'));
    render(<MoreAppsPage />);
    expect(await screen.findByText('客户关系')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('横幅加载失败');
    expect(screen.queryByText('客户运费')).not.toBeInTheDocument();
  });

  it('shows a fallback when a banner image fails', async () => {
    fetchBannersMock.mockResolvedValueOnce([{
      id: 'broken',
      title: '图片失败',
      subtitle: '',
      imageUrl: 'https://cdn.example.com/broken.png',
      targetType: 'NONE',
      targetAppId: null,
      targetUrl: '',
      order: 1,
    }]);
    render(<MoreAppsPage />);
    const image = await screen.findByRole('img', { name: '图片失败' });
    fireEvent.error(image);
    expect(await screen.findByText('图片失败')).toBeInTheDocument();
  });
});
