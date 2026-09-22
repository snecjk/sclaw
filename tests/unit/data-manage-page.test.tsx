import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataManagePage } from '@/pages/DataCenter/data-manage/DataManagePage';
import { buildDataManageEmbedHref } from '@/pages/DataCenter/data-manage/constants';

const listFinanceBiDatasourceSonMock = vi.fn();
const deleteFinanceBiDatasourceSonMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/lib/finance-bi-api', () => ({
  listFinanceBiDatasourceSon: (...args: unknown[]) => listFinanceBiDatasourceSonMock(...args),
  deleteFinanceBiDatasourceSon: (...args: unknown[]) => deleteFinanceBiDatasourceSonMock(...args),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector: (state: { user: { code: string } }) => unknown) =>
    selector({ user: { code: 'U001' } }),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: { value?: string; count?: number }) => {
      const labels: Record<string, string> = {
        'dataCenterPage.dataManage.platformTab': '平台数据源',
        'dataCenterPage.dataManage.ownedTab': '网点自有数据',
        'dataCenterPage.dataManage.searchPlaceholder': '搜索任务名称或描述',
        'dataCenterPage.dataManage.filterAll': '全部',
        'dataCenterPage.dataManage.filterFile': '文件',
        'dataCenterPage.dataManage.filterApi': 'API',
        'dataCenterPage.dataManage.createOwned': '新建自有数据',
        'dataCenterPage.dataManage.loading': '正在加载数据源…',
        'dataCenterPage.dataManage.emptyDescription': '暂无匹配的数据资产',
        'dataCenterPage.dataManage.noFields': '无字段',
        'dataCenterPage.dataManage.createReport': '新建报表',
        'dataCenterPage.dataManage.edit': '编辑',
        'dataCenterPage.dataManage.editDisabledTable': '数据库表数据源暂不支持编辑',
        'dataCenterPage.dataManage.view': '查看',
        'dataCenterPage.dataManage.detail': '详情',
        'dataCenterPage.dataManage.delete': '删除',
        'dataCenterPage.dataManage.deleteTitle': '删除数据源',
        'dataCenterPage.dataManage.deleteMessage': '确认删除该自有数据源？',
        'dataCenterPage.dataManage.deleteConfirm': '删除',
        'dataCenterPage.dataManage.deleteCancel': '取消',
        'dataCenterPage.dataManage.deleteSuccess': '已删除',
        'dataCenterPage.dataManage.detailClose': '关闭详情',
        'dataCenterPage.dataManage.detailBasic': '基本信息',
        'dataCenterPage.dataManage.detailDescription': '数据源说明',
        'dataCenterPage.dataManage.detailEmpty': '无',
        'dataCenterPage.dataManage.detailGroup': '数据来源',
        'dataCenterPage.dataManage.detailRuntime': '运行状态',
        'dataCenterPage.dataManage.detailStatus': '当前状态',
        'dataCenterPage.dataManage.detailMsg': '说明',
        'dataCenterPage.dataManage.detailFreq': '更新频率',
        'dataCenterPage.dataManage.detailFailPolicy': '同步失败策略',
        'dataCenterPage.dataManage.detailSyncRange': '同步时间范围',
        'dataCenterPage.dataManage.detailFieldName': '字段名称',
        'dataCenterPage.dataManage.detailFieldRaw': '原字段名',
        'dataCenterPage.dataManage.detailFieldType': '类型',
        'dataCenterPage.dataManage.detailFieldSample': '示例值',
        'dataCenterPage.feedback.loadingDescription': '正在获取数据中心文件',
        'dataCenterPage.feedback.empty': '暂无文件',
      };
      if (key === 'dataCenterPage.dataManage.fieldLabel') return `字段: ${options?.value ?? ''}`;
      if (key === 'dataCenterPage.dataManage.detailFields') return `字段列表（共 ${options?.count ?? 0} 个）`;
      return labels[key] ?? key;
    },
  }),
}));

const sampleRow = {
  id: '1',
  code: 'ds_1',
  name: '叉车明细表',
  type: 'Excel',
  status: 'success',
  statusLabel: '正常',
  statusName: '导入成功',
  models: [],
  configuration: JSON.stringify({
    accessMode: 'file',
    fields: [{ displayName: '财务结算', oldName: 'a', checked: true }],
  }),
};

describe('DataManagePage', () => {
  beforeEach(() => {
    listFinanceBiDatasourceSonMock.mockReset();
    deleteFinanceBiDatasourceSonMock.mockReset();
    navigateMock.mockReset();
    listFinanceBiDatasourceSonMock.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      list: [sampleRow],
    });
    deleteFinanceBiDatasourceSonMock.mockResolvedValue(undefined);
  });

  it('opens the in-app embed page when creating an owned datasource', () => {
    render(
      <MemoryRouter>
        <DataManagePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '新建自有数据' }));

    expect(navigateMock).toHaveBeenCalledWith(buildDataManageEmbedHref({ kind: 'create-owned' }));
  });

  it('only exposes datasource read on platform sources', async () => {
    render(
      <MemoryRouter>
        <DataManagePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('叉车明细表')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: '新建报表' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    const dialog = screen.getByRole('dialog', { name: '叉车明细表' });
    expect(dialog).toHaveClass('sto-overlay', 'no-drag');
    expect(dialog).toHaveTextContent('基本信息');

    const closeButton = screen.getByRole('button', { name: '关闭详情' });
    expect(closeButton).toHaveClass('no-drag');
    fireEvent.mouseDown(closeButton);
    expect(screen.queryByRole('dialog', { name: '叉车明细表' })).not.toBeInTheDocument();
  });

  it('edits and deletes owned datasources', async () => {
    render(
      <MemoryRouter>
        <DataManagePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /网点自有数据/ }));
    await waitFor(() => expect(screen.getByText('叉车明细表')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: '新建报表' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(navigateMock).toHaveBeenCalledWith(
      buildDataManageEmbedHref({ kind: 'edit-owned', editId: 'ds_1' }),
    );

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(deleteFinanceBiDatasourceSonMock).toHaveBeenCalledWith('ds_1');
    });
  });
});
