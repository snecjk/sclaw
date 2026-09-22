import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContentHeaderProvider,
  useContentHeaderDisplay,
} from '@/components/layout/content-header-context';
import { buildDataManagePreviewUrl } from '@/pages/DataCenter/data-manage/constants';
import { DataManageCreatePage } from '@/pages/DataCenter/data-manage/DataManageCreatePage';

const { resolveEmbedMock } = vi.hoisted(() => ({
  resolveEmbedMock: vi.fn(),
}));

vi.mock('@/pages/DataCenter/data-manage/create-owned-sso', () => ({
  resolveDataManagePreviewEmbed: (...args: unknown[]) => resolveEmbedMock(...args),
  buildPreviewAuthInjectScript: () => '',
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'dataCenterPage.dataManage.createOwned': '新建自有数据',
        'dataCenterPage.dataManage.edit': '编辑',
        'dataCenterPage.dataManage.createOwnedBackAria': '返回数据管理',
        'dataCenterPage.dataManage.createOwnedSsoLoading': '正在打开页面…',
        'dataCenterPage.dataManage.createOwnedSsoFailed': '免登链接获取失败，已直接打开目标页',
        'common:sidebar.dataCenter': '数据中心',
      };
      return labels[key] ?? key;
    },
  }),
}));

function HeaderTitle() {
  return <>{useContentHeaderDisplay().title}</>;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe('DataManageCreatePage', () => {
  beforeEach(() => {
    resolveEmbedMock.mockReset();
    resolveEmbedMock.mockImplementation(async (url: string) => ({
      url,
      injectAuth: {
        token: 'bi-token',
        userInfo: {},
        stoBiUserInfo: {},
        exp: 1,
        time: 1,
      },
    }));
  });

  it('embeds the create page with source=sclaw and can go back', async () => {
    const previewUrl = buildDataManagePreviewUrl({ kind: 'create-owned' });
    render(
      <MemoryRouter initialEntries={['/data-center/data-manage/create?kind=create-owned']}>
        <ContentHeaderProvider>
          <HeaderTitle />
          <LocationProbe />
          <Routes>
            <Route path="/data-center/data-manage/create" element={<DataManageCreatePage />} />
            <Route path="/data-center" element={<div>data-manage-list</div>} />
          </Routes>
        </ContentHeaderProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('正在打开页面…')).toBeInTheDocument();

    const frame = await waitFor(() => screen.getByTitle('新建自有数据'));
    expect(['iframe', 'webview']).toContain(frame.tagName.toLowerCase());
    expect(frame).toHaveAttribute('src', previewUrl);
    expect(previewUrl).toContain('source=sclaw');

    fireEvent.click(screen.getByRole('button', { name: '返回数据管理' }));

    expect(screen.getByText('data-manage-list')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/data-center?section=data_manage');
  });

  it('embeds the edit page with source=sclaw', async () => {
    const previewUrl = buildDataManagePreviewUrl({ kind: 'edit-owned', editId: 'ds_1' });
    render(
      <MemoryRouter initialEntries={['/data-center/data-manage/create?kind=edit-owned&editId=ds_1']}>
        <ContentHeaderProvider>
          <HeaderTitle />
          <Routes>
            <Route path="/data-center/data-manage/create" element={<DataManageCreatePage />} />
          </Routes>
        </ContentHeaderProvider>
      </MemoryRouter>,
    );

    const frame = await waitFor(() => screen.getByTitle('编辑'));
    expect(frame).toHaveAttribute('src', previewUrl);
    expect(previewUrl).toContain('source=sclaw');
    expect(previewUrl).toContain('editId=ds_1');
  });
});
