import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchAppsMock = vi.fn();
const fetchCategoriesMock = vi.fn();
const fetchBannersMock = vi.fn();
const fetchSkipLoginLinkMock = vi.fn();
const openInSclawBrowserMock = vi.fn();
const fetchRegistryMock = vi.fn();
const hasStoPolicyAuthInEmbedSessionMock = vi.fn();
const hasTeambitionAuthInEmbedSessionMock = vi.fn();
let mockCanUseAppDev = true;

vi.mock('@/hooks/use-app-dev-permission', () => ({
  useAppDevPermission: () => ({
    canUseAppDev: mockCanUseAppDev,
    loaded: true,
  }),
}));

vi.mock('@/lib/app-plaza-api', () => ({
  fetchAppPlazaApps: (...args: unknown[]) => fetchAppsMock(...args),
  fetchAppPlazaCategories: (...args: unknown[]) => fetchCategoriesMock(...args),
  fetchAppPlazaBanners: (...args: unknown[]) => fetchBannersMock(...args),
  fetchAppPlazaSkipLoginLink: (...args: unknown[]) => fetchSkipLoginLinkMock(...args),
  appendSkipLoginReturnUrl: (skipLoginUrl: string, returnUrl: string) => {
    if (!returnUrl) return skipLoginUrl;
    return `${skipLoginUrl}&returnUrl=${encodeURIComponent(returnUrl)}`;
  },
}));

vi.mock('@/lib/open-sclaw-browser', () => ({
  openInSclawBrowser: (...args: unknown[]) => openInSclawBrowserMock(...args),
}));

vi.mock('@/lib/embed-site-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/embed-site-auth')>();
  return {
    ...actual,
    hasStoPolicyAuthInEmbedSession: (...args: unknown[]) => hasStoPolicyAuthInEmbedSessionMock(...args),
    hasTeambitionAuthInEmbedSession: (...args: unknown[]) => hasTeambitionAuthInEmbedSessionMock(...args),
  };
});

vi.mock('@/lib/sto-policy-web-url', () => ({
  hasStoPolicyAuthInEmbedSession: (...args: unknown[]) => hasStoPolicyAuthInEmbedSessionMock(...args),
}));

vi.mock('@/lib/more-apps-api', () => ({
  fetchMoreAppsRegistry: (...args: unknown[]) => fetchRegistryMock(...args),
  saveMoreAppsRegistry: vi.fn(async (registry) => registry),
  migrateMoreAppsRegistry: vi.fn(async (registry) => ({ migrated: true, registry })),
}));

const refreshDevAppsMock = vi.fn(async () => undefined);
let mockDevApps: Array<{
  workspaceId: string;
  name: string;
  projectType: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  pageType?: 'site' | 'assets';
}> = [];

vi.mock('@/stores/app-dev-catalog', () => ({
  useAppDevCatalogStore: Object.assign(
    (selector: (state: { apps: typeof mockDevApps; refresh: typeof refreshDevAppsMock }) => unknown) =>
      selector({ apps: mockDevApps, refresh: refreshDevAppsMock }),
    {
      getState: () => ({
        apps: mockDevApps,
        refresh: refreshDevAppsMock,
        registerWorkspaceId: vi.fn(),
      }),
    },
  ),
}));

vi.mock('@/lib/session-catalog-api', () => ({
  pickProjectFolder: vi.fn(async () => null),
}));

vi.mock('@/lib/app-dev-api', () => ({
  importUserApp: vi.fn(),
}));

vi.mock('@/stores/session-catalog', () => ({
  useSessionCatalogStore: Object.assign(
    (selector: (state: { refreshWorkspaces: () => Promise<void> }) => unknown) =>
      selector({ refreshWorkspaces: vi.fn(async () => undefined) }),
    {
      getState: () => ({
        refreshWorkspaces: vi.fn(async () => undefined),
      }),
    },
  ),
}));

vi.mock('@/stores/app-plaza-shell', () => ({
  useAppPlazaShellStore: Object.assign(
    () => ({}),
    {
      getState: () => ({
        openOrFocusDevAppTab: vi.fn(),
      }),
    },
  ),
}));

import { MoreAppsPage } from '@/components/more-apps/MoreAppsPage';
import { useMoreAppsStore } from '@/stores/more-apps';

const serverApp = {
  id: 'org-relation',
  name: '客户关系',
  description: '维护客户归属关系',
  badge: '客户管理, 部门岗位；客户对账、部门岗位',
  url: 'https://example.com/org',
  iconKey: 'org-relation',
  iconUrl: 'https://cdn.example.com/org-relation.png',
  tone: 'blue' as const,
  kind: 'builtin' as const,
};

function resetStore() {
  useMoreAppsStore.setState({
    activeTab: 'market',
    searchQuery: '',
    marketCategory: 'featured',
    heroSlideIndex: 0,
    banners: [],
    bannersLoading: false,
    bannersError: null,
    categories: [],
    categoryCounts: {},
    categoriesLoading: false,
    categoriesError: null,
    apps: [],
    catalogApps: [],
    marketTotal: 0,
    total: 0,
    pageNum: 0,
    loading: false,
    loadingMore: false,
    error: null,
    externalApps: [],
    installedIds: [],
    favoriteIds: [],
    hydrated: false,
    hydrating: false,
    addModalOpen: false,
    editingExternalAppId: null,
  });
}

describe('MoreAppsPage server catalog', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCanUseAppDev = true;
    resetStore();
    mockDevApps = [];
    refreshDevAppsMock.mockReset().mockResolvedValue(undefined);
    openInSclawBrowserMock.mockReset();
    fetchSkipLoginLinkMock.mockReset();
    hasStoPolicyAuthInEmbedSessionMock.mockReset().mockResolvedValue(false);
    hasTeambitionAuthInEmbedSessionMock.mockReset().mockResolvedValue(false);
    fetchBannersMock.mockReset().mockResolvedValue([]);
    fetchCategoriesMock.mockReset().mockResolvedValue([]);
    fetchAppsMock.mockReset().mockResolvedValue({
      items: [serverApp],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });
    fetchRegistryMock.mockReset().mockResolvedValue({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: [],
    });
  });

  it('renders mixed-delimiter server badges as one deduplicated ideographic-comma label', async () => {
    render(<MoreAppsPage />);
    const addButton = screen.getByRole('button', { name: '安装外部应用' });
    expect(addButton.querySelector('.lucide-download')).toBeInTheDocument();
    expect(addButton.closest('.app-plaza-heading-row')).toBeInTheDocument();
    expect(screen.getByRole('tablist').closest('.more-apps-toolbar-row')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索应用名称或描述').closest('.more-apps-toolbar-row')).toBeInTheDocument();
    expect(await screen.findByText('客户管理、部门岗位、客户对账')).toHaveClass('app-market__row-tags');
    expect(document.querySelectorAll('.app-market__row-tags')).toHaveLength(1);
    expect(screen.queryByText('维护客户归属关系')).not.toBeInTheDocument();
  });

  it('portals the external-app modal outside the page stacking context', () => {
    const { container } = render(
      <div data-app-shell="provincial">
        <MoreAppsPage />
      </div>,
    );
    const appShell = container.querySelector('[data-app-shell]');
    const page = container.querySelector('.page-more-apps');

    fireEvent.click(screen.getByRole('button', { name: '安装外部应用' }));

    const modal = document.querySelector<HTMLElement>('.more-apps-modal');
    expect(modal).not.toBeNull();
    expect(modal?.parentElement).toBe(appShell);
    expect(page?.contains(modal)).toBe(false);
  });

  it('shows the uploaded app image and falls back to the configured icon when it fails', async () => {
    render(<MoreAppsPage />);
    const image = await waitFor(() => {
      const element = document.querySelector<HTMLImageElement>(
        '.app-market__row .app-icon__img',
      );
      expect(element).not.toBeNull();
      return element!;
    });
    expect(image).toHaveAttribute('src', 'https://cdn.example.com/org-relation.png');
    expect(image.closest('.app-icon')).toHaveClass('app-icon--rounded');

    fireEvent.error(image);
    await waitFor(() => {
      expect(document.querySelector('.app-market__row .app-icon__img')).not.toBeInTheDocument();
      expect(document.querySelector('.app-market__row .app-icon svg')).toBeInTheDocument();
    });
  });

  it('reserves the tag row when the app has no valid badges', async () => {
    fetchAppsMock.mockResolvedValueOnce({
      items: [{ ...serverApp, badge: '，；、  ' }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });

    render(<MoreAppsPage />);
    expect(await screen.findByText('客户关系')).toBeInTheDocument();
    const emptyTagRow = document.querySelector('.app-market__row-tags');
    expect(emptyTagRow).toBeInTheDocument();
    expect(emptyTagRow).toBeEmptyDOMElement();
    expect(emptyTagRow).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens the card through its overlay action and keeps favorite clicks isolated from opening', async () => {
    render(<MoreAppsPage />);
    const card = await screen.findByRole('button', { name: '打开客户关系' });

    fireEvent.click(card, { detail: 0 });
    expect(await screen.findByText('需要二次登录')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => {
      expect(openInSclawBrowserMock).toHaveBeenCalledWith({
        url: 'https://example.com/org',
        title: '客户关系',
        appId: 'org-relation',
        sourceUrl: 'https://example.com/org',
        skipLoginEligible: true,
        systemCode: undefined,
        iconKey: 'org-relation',
        iconUrl: 'https://cdn.example.com/org-relation.png',
        tone: 'blue',
      });
    });

    openInSclawBrowserMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    expect(openInSclawBrowserMock).not.toHaveBeenCalled();
    expect(useMoreAppsStore.getState().favoriteIds).toContain('org-relation');
  });

  it('asks for confirmation before opening sto-policy apps without skip-login exchange', async () => {
    fetchAppsMock.mockResolvedValueOnce({
      items: [{
        ...serverApp,
        id: 'policy-app',
        name: '制度中心',
        systemCode: 'sto-policy',
        url: 'https://zc.sto.cn/',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '打开制度中心' }));

    expect(openInSclawBrowserMock).not.toHaveBeenCalled();
    expect(await screen.findByText('需要二次登录')).toBeInTheDocument();
    expect(screen.getByText('该系统需要二次登录，确认后将继续打开。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => {
      expect(fetchSkipLoginLinkMock).not.toHaveBeenCalled();
      expect(openInSclawBrowserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://zc.sto.cn/',
          appId: 'policy-app',
          skipLoginEligible: true,
          systemCode: 'sto-policy',
          sourceUrl: 'https://zc.sto.cn/',
        }),
      );
    });
  });

  it('does not ask again for sto-policy when embed cookies still have a valid auth token', async () => {
    hasStoPolicyAuthInEmbedSessionMock.mockResolvedValue(true);
    fetchAppsMock.mockResolvedValueOnce({
      items: [{
        ...serverApp,
        id: 'policy-app',
        name: '制度中心',
        systemCode: 'sto-policy',
        url: 'https://zc.sto.cn/',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '打开制度中心' }));

    await waitFor(() => {
      expect(screen.queryByText('需要二次登录')).not.toBeInTheDocument();
      expect(fetchSkipLoginLinkMock).not.toHaveBeenCalled();
      expect(openInSclawBrowserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://zc.sto.cn/',
          appId: 'policy-app',
          skipLoginEligible: true,
          systemCode: 'sto-policy',
        }),
      );
    });
  });

  it('asks for confirmation when sto-policy auth cookie is expired or missing', async () => {
    hasStoPolicyAuthInEmbedSessionMock.mockResolvedValue(false);
    fetchAppsMock.mockResolvedValueOnce({
      items: [{
        ...serverApp,
        id: 'policy-app',
        name: '制度中心',
        systemCode: 'sto-policy',
        url: 'https://zc.sto.cn/',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '打开制度中心' }));

    expect(await screen.findByText('需要二次登录')).toBeInTheDocument();
    expect(openInSclawBrowserMock).not.toHaveBeenCalled();
  });

  it('skips confirmation for Teambition when TEAMBITION_SESSIONID is still valid', async () => {
    hasTeambitionAuthInEmbedSessionMock.mockResolvedValue(true);
    fetchAppsMock.mockResolvedValueOnce({
      items: [{
        ...serverApp,
        id: 'teambition-app',
        name: 'Teambition',
        systemCode: '',
        url: 'https://www.teambition.com/project',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '打开Teambition' }));

    await waitFor(() => {
      expect(screen.queryByText('需要二次登录')).not.toBeInTheDocument();
      expect(fetchSkipLoginLinkMock).not.toHaveBeenCalled();
      expect(openInSclawBrowserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://www.teambition.com/project',
          appId: 'teambition-app',
          skipLoginEligible: true,
        }),
      );
    });
  });

  it('asks for confirmation for Teambition when TEAMBITION_SESSIONID is missing', async () => {
    hasTeambitionAuthInEmbedSessionMock.mockResolvedValue(false);
    fetchAppsMock.mockResolvedValueOnce({
      items: [{
        ...serverApp,
        id: 'teambition-app',
        name: 'Teambition',
        systemCode: '',
        url: 'https://www.teambition.com/project',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '打开Teambition' }));

    expect(await screen.findByText('需要二次登录')).toBeInTheDocument();
    expect(openInSclawBrowserMock).not.toHaveBeenCalled();
  });

  it('asks for confirmation when systemCode is empty (no skip-login exchange)', async () => {
    fetchAppsMock.mockResolvedValueOnce({
      items: [{
        ...serverApp,
        id: 'plain-app',
        name: '普通应用',
        systemCode: '',
        url: 'https://example.com/plain',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '打开普通应用' }));

    expect(openInSclawBrowserMock).not.toHaveBeenCalled();
    expect(fetchSkipLoginLinkMock).not.toHaveBeenCalled();
    expect(await screen.findByText('需要二次登录')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => {
      expect(fetchSkipLoginLinkMock).not.toHaveBeenCalled();
      expect(openInSclawBrowserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/plain',
          appId: 'plain-app',
          skipLoginEligible: true,
          systemCode: undefined,
        }),
      );
    });
  });

  it('does not use skip-login or confirmation for external apps in 我的应用', async () => {
    fetchRegistryMock.mockResolvedValueOnce({
      version: 1,
      externalApps: [{
        id: 'ext-app',
        name: '外部应用',
        description: '自定义链接',
        url: 'https://example.com/external',
        systemCode: 'SITE_KEEPER',
        external: true,
        kind: 'external',
      }],
      installedIds: [],
      favoriteIds: [],
    });

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: '我的应用' }));
    expect(screen.getByText('外部')).toHaveClass('sto-feedback', 'sto-feedback--badge');
    expect(screen.getByText('外部')).toHaveAttribute('data-variant', 'external');
    fireEvent.click(screen.getByRole('button', { name: '打开外部应用' }));

    expect(screen.queryByText('需要二次登录')).not.toBeInTheDocument();
    expect(fetchSkipLoginLinkMock).not.toHaveBeenCalled();
    expect(openInSclawBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/external',
        appId: 'ext-app',
        skipLoginEligible: false,
        systemCode: 'SITE_KEEPER',
      }),
    );
  });

  it('uses semantic status badges for official and hot installed-app metadata', async () => {
    fetchAppsMock.mockResolvedValueOnce({
      items: [{ ...serverApp, official: true, badge: '热门' }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });
    fetchRegistryMock.mockResolvedValueOnce({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: ['org-relation'],
    });

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: '我的应用' }));

    expect(screen.getByText('官方')).toHaveAttribute('data-variant', 'official');
    expect(screen.getByText('热门')).toHaveAttribute('data-variant', 'hot');
    expect(screen.getByText('打开')).not.toHaveClass('cursor-pointer');
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

  it('opens an APP banner with the server-provided APP url', async () => {
    fetchBannersMock.mockResolvedValueOnce([{
      id: 'customer-relations',
      title: '客户关系管理升级',
      subtitle: '',
      imageUrl: 'https://cdn.example.com/customer-relations.png',
      targetType: 'APP',
      targetAppId: 'org-relation',
      targetUrl: '',
      order: 1,
    }]);
    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '客户关系管理升级' }));
    expect(await screen.findByText('需要二次登录')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => {
      expect(openInSclawBrowserMock).toHaveBeenCalledWith({
        url: 'https://example.com/org',
        title: '客户关系',
        appId: 'org-relation',
        sourceUrl: 'https://example.com/org',
        skipLoginEligible: true,
        systemCode: undefined,
        iconKey: 'org-relation',
        iconUrl: 'https://cdn.example.com/org-relation.png',
        tone: 'blue',
      });
    });
  });

  it('does not fall back to a built-in url when the target APP is absent from the server catalog', async () => {
    fetchAppsMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      pageNum: 1,
      pageSize: 20,
    });
    fetchBannersMock.mockResolvedValueOnce([{
      id: 'customer-relations',
      title: '客户关系管理升级',
      subtitle: '',
      imageUrl: 'https://cdn.example.com/customer-relations.png',
      targetType: 'APP',
      targetAppId: 'org-relation',
      targetUrl: '',
      order: 1,
    }]);
    render(<MoreAppsPage />);
    await screen.findByRole('img', { name: '客户关系管理升级' });
    expect(screen.queryByRole('button', { name: '客户关系管理升级' })).not.toBeInTheDocument();
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

  it('shows the unfiltered total for featured and each server category', async () => {
    fetchCategoriesMock.mockResolvedValueOnce([
      { id: 'test', name: '测试专用', description: '', iconKey: '', iconUrl: '', order: 1 },
      { id: 'ops', name: '经营管理', description: '', iconKey: '', iconUrl: '', order: 2 },
    ]);
    fetchAppsMock.mockImplementation(async (params: { categoryCode?: string; pageSize: number }) => ({
      items: params.pageSize === 20 && !params.categoryCode ? [serverApp] : [],
      total: params.categoryCode === 'test' ? 4 : params.categoryCode === 'ops' ? 2 : 13,
      pageNum: 1,
      pageSize: params.pageSize,
    }));

    render(<MoreAppsPage />);

    expect(await screen.findByRole('button', { name: '测试专用' })).toHaveTextContent('测试专用4');
    expect(screen.getByRole('button', { name: '经营管理' })).toHaveTextContent('经营管理2');
    expect(screen.getByRole('button', { name: '精选' })).toHaveTextContent('精选13');
    expect(screen.getByRole('tab', { name: '应用广场' })).toHaveTextContent(/^应用广场$/);
    expect(screen.getByRole('tab', { name: '我的应用' })).toHaveTextContent(/^我的应用$/);
    expect(screen.getByRole('tab', { name: '开发应用' })).toHaveTextContent(/^开发应用$/);
  });

  it('shows the app link in my apps when a favorited server app has no recent usage', async () => {
    fetchRegistryMock.mockResolvedValueOnce({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: ['org-relation'],
    });

    render(<MoreAppsPage />);
    expect(await screen.findByRole('tab', { name: '我的应用' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '我的应用' }));

    expect(screen.getByText('客户关系')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.queryByText('点击安装后可用')).not.toBeInTheDocument();
  });

  it('keeps installed apps independent from market category changes', async () => {
    fetchRegistryMock.mockResolvedValueOnce({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: ['org-relation'],
    });
    fetchCategoriesMock.mockResolvedValueOnce([
      { id: 'org', name: '组织管理', description: '', iconKey: '', iconUrl: '', order: 1 },
    ]);
    fetchAppsMock
      .mockResolvedValueOnce({ items: [serverApp], total: 8, pageNum: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 3, pageNum: 1, pageSize: 20 });

    render(<MoreAppsPage />);
    expect(await screen.findByRole('tab', { name: '应用广场' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '我的应用' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '我的应用' }));
    expect(screen.getByText('客户关系')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '应用广场' }));
    fireEvent.click(await screen.findByRole('button', { name: '组织管理' }));
    await waitFor(() => expect(fetchAppsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      categoryCode: 'org',
    })));
    expect(screen.getByRole('tab', { name: '应用广场' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '我的应用' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '我的应用' }));
    expect(screen.getByText('客户关系')).toBeInTheDocument();
  });

  it('shows the empty state when registry IDs do not resolve to rendered cards', async () => {
    fetchRegistryMock.mockResolvedValueOnce({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: ['missing-app'],
    });

    render(<MoreAppsPage />);
    expect(await screen.findByRole('tab', { name: '我的应用' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '我的应用' }));
    expect(screen.getByText('还没有收藏或安装应用，去应用广场看看')).toBeInTheDocument();
  });

  it('keeps developing apps on a dedicated tab instead of 我的应用', async () => {
    mockDevApps = [{
      workspaceId: 'ws-dev-1',
      name: 'test-app080503',
      projectType: 'react-a2ui',
      path: '/tmp/test-app080503',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    fetchRegistryMock.mockResolvedValueOnce({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: ['org-relation'],
    });

    render(<MoreAppsPage />);
    expect(await screen.findByRole('tab', { name: '开发应用' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '我的应用' }));
    expect(screen.getByText('客户关系')).toBeInTheDocument();
    expect(screen.queryByText('test-app080503')).not.toBeInTheDocument();
    expect(screen.queryByText('开发应用', { selector: 'h2' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '开发应用' }));
    expect(screen.getByText('test-app080503')).toBeInTheDocument();
    expect(screen.queryByText('客户关系')).not.toBeInTheDocument();
  });

  it('lists development apps of both page types without a type filter row', async () => {
    mockDevApps = [
      {
        workspaceId: 'ws-site',
        name: 'Site Alpha',
        projectType: 'frontend',
        path: '/tmp/site-alpha',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageType: 'site',
      },
      {
        workspaceId: 'ws-assets',
        name: 'Assets Beta',
        projectType: 'frontend',
        path: '/tmp/assets-beta',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageType: 'assets',
      },
    ];

    render(<MoreAppsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: '开发应用' }));

    expect(screen.queryByRole('button', { name: '全部' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('开发应用类型筛选')).not.toBeInTheDocument();
    expect(screen.getByText('Site Alpha')).toBeInTheDocument();
    expect(screen.getByText('Assets Beta')).toBeInTheDocument();
    expect(refreshDevAppsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the APP list available when banners fail', async () => {
    fetchBannersMock.mockRejectedValueOnce(new Error('banner unavailable'));
    render(<MoreAppsPage />);
    expect(await screen.findByText('客户关系')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('横幅加载失败');
    expect(screen.queryByText('客户运费')).not.toBeInTheDocument();
  });

  it('hides app-dev actions and tab when the user is not whitelisted', async () => {
    mockCanUseAppDev = false;
    useMoreAppsStore.setState({ activeTab: 'dev-apps' });

    render(<MoreAppsPage />);

    expect(await screen.findByRole('tab', { name: '应用广场' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '我的应用' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '开发应用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建应用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导入应用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多开发操作' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安装外部应用' })).toBeInTheDocument();
    expect(useMoreAppsStore.getState().activeTab).toBe('market');
  });

  it('opens create app directly and keeps import in the overflow menu', () => {
    render(<MoreAppsPage />);

    const createBtn = screen.getByRole('button', { name: '创建应用' });
    expect(createBtn).toHaveClass('more-apps-add-btn');
    expect(createBtn).not.toHaveAttribute('aria-haspopup');
    expect(createBtn.querySelector('.lucide-chevron-down')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导入应用' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多开发操作' })).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('shows template management to app-dev whitelist users', async () => {
    render(<MoreAppsPage />);

    fireEvent.pointerDown(screen.getByRole('button', { name: '更多开发操作' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByRole('menuitem', { name: '管理应用模板' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '导入应用' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '创建应用' })).not.toBeInTheDocument();
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
