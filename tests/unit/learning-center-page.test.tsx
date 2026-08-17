import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ContentHeaderProvider } from '@/components/layout/content-header-context';
import { LearningCenterPage } from '@/pages/LearningCenter/LearningCenterPage';
import {
  getTutorialDetail,
  LearningCenterApiError,
  pageLearningCases,
  pageLearningCategories,
  pageLearningDomains,
  pageLearningTutorials,
} from '@/lib/learning-center-api';

vi.mock('@/lib/learning-center-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/learning-center-api')>();
  return {
    ...actual,
    pageLearningDomains: vi.fn(),
    pageLearningCategories: vi.fn(),
    pageLearningTutorials: vi.fn(),
    pageLearningCases: vi.fn(),
    getTutorialDetail: vi.fn(),
  };
});

const domainsMock = vi.mocked(pageLearningDomains);
const categoriesMock = vi.mocked(pageLearningCategories);
const tutorialsMock = vi.mocked(pageLearningTutorials);
const casesMock = vi.mocked(pageLearningCases);
const tutorialDetailMock = vi.mocked(getTutorialDetail);

const domain = {
  id: '90071992547409930', domainCode: 'AI', name: 'AI 学习中心', mainTitle: 'AI 成长中心',
  subTitle: '从教程到实践', description: '学习描述', coverImageUrl: '', status: 'PUBLISHED' as const,
  statusRaw: 'PUBLISHED', sortOrder: 0,
};
const category = {
  id: '90071992547409931', domainId: domain.id, categoryCode: 'START', name: '快速开始', title: '快速开始',
  subTitle: '', description: '', imageUrl: '', status: 'PUBLISHED' as const, statusRaw: 'PUBLISHED', sortOrder: 0,
};
const categoryTwo = { ...category, id: '90071992547409932', categoryCode: 'ADVANCED', name: '进阶实践', title: '进阶实践', sortOrder: 1 };
const categoryThree = { ...category, id: '90071992547409933', categoryCode: 'EXPERT', name: '专家案例', title: '专家案例', sortOrder: 2 };
const tutorial = {
  id: '91000000000000001', categoryId: category.id, tutorialCode: 'T1', name: '入门教程', title: '入门教程',
  subTitle: '十分钟上手', description: '教程简介', contentType: 'RICH_TEXT' as const, contentTypeRaw: 'RICH_TEXT',
  contentImageUrl: '', content: '<h2>教程正文</h2>', contentRefCode: '', status: 'PUBLISHED' as const,
  statusRaw: 'PUBLISHED', sortOrder: 0,
};
const caseItem = {
  id: '92000000000000001', categoryId: category.id, tutorialId: tutorial.id, tutorialIds: [tutorial.id],
  caseCode: 'C1', name: '实践案例', title: '实践案例', subTitle: '案例副标题', description: '案例简介', coverImageUrl: '',
  sceneTitle: '', sceneDescription: '', targetType: 'CHAT' as const, targetTypeRaw: 'CHAT', targetCode: '', targetUrl: '',
  promptText: null, promptMode: 'REPLACE' as const, promptModeRaw: 'REPLACE', actionText: '立即使用', useCount: 0,
  status: 'PUBLISHED' as const, statusRaw: 'PUBLISHED', sortOrder: 0,
};

function tutorialPage(items = [tutorial], pageNum = 1, total = items.length) {
  return { items, total, pageNum, pageSize: 6 };
}

function casePage(items = [caseItem], pageNum = 1, total = items.length) {
  return { items, total, pageNum, pageSize: 6 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/learning-center']}>
      <ContentHeaderProvider><LearningCenterPage /></ContentHeaderProvider>
    </MemoryRouter>,
  );
}

function activateTab(name: string, hidden = false) {
  const tab = screen.getByRole('tab', { name, hidden });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
}

describe('LearningCenterPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    vi.clearAllMocks();
    domainsMock.mockResolvedValue({ items: [domain], total: 1, pageNum: 1, pageSize: 20 });
    categoriesMock.mockResolvedValue({ items: [category], total: 1, pageNum: 1, pageSize: 100 });
    tutorialsMock.mockResolvedValue(tutorialPage());
    casesMock.mockResolvedValue(casePage());
    tutorialDetailMock.mockResolvedValue(tutorial);
  });

  it('loads the first visible category and both content regions', async () => {
    renderPage();
    expect(screen.getByText('正在加载学习中心')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'AI 成长中心' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '快速开始' })).toHaveAttribute('data-state', 'active');
    expect(await screen.findByText('十分钟上手')).toBeInTheDocument();
    expect(screen.getByText('案例副标题')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '学习分类' })).toHaveStyle('--lc-steps-height: 250px');
    expect(tutorialsMock).toHaveBeenCalledWith(category.id, { pageNum: 1, pageSize: 6 });
    expect(casesMock).toHaveBeenCalledWith(category.id, { pageNum: 1, pageSize: 6 });
  });

  it('shows at most six tutorials and grows by each forty-pixel row plus its gap', async () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      ...tutorial,
      id: `tutorial-${index + 1}`,
      title: `教程 ${index + 1}`,
      subTitle: '',
    }));
    tutorialsMock.mockResolvedValue(tutorialPage(items, 1, items.length));

    renderPage();

    expect(await screen.findByText('教程 6')).toBeInTheDocument();
    expect(screen.queryByText('教程 7')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '学习分类' })).toHaveStyle('--lc-steps-height: 406px');
  });

  it('shows a domain empty state without requesting descendants', async () => {
    domainsMock.mockResolvedValue({ items: [], total: 0, pageNum: 1, pageSize: 20 });
    renderPage();
    expect(await screen.findByText('暂无可见学习内容')).toBeInTheDocument();
    expect(categoriesMock).not.toHaveBeenCalled();
    expect(tutorialsMock).not.toHaveBeenCalled();
    expect(casesMock).not.toHaveBeenCalled();
  });

  it('shows a category empty state while retaining the domain header', async () => {
    categoriesMock.mockResolvedValue({ items: [], total: 0, pageNum: 1, pageSize: 100 });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'AI 成长中心' })).toBeInTheDocument();
    expect(screen.getByText('这个学习域还没有分类')).toBeInTheDocument();
  });

  it('ignores late responses during rapid category switching', async () => {
    categoriesMock.mockResolvedValue({ items: [category, categoryTwo, categoryThree], total: 3, pageNum: 1, pageSize: 100 });
    const oldTutorial = deferred<ReturnType<typeof tutorialPage>>();
    const oldCases = deferred<ReturnType<typeof casePage>>();
    tutorialsMock.mockImplementation((categoryId) => {
      if (categoryId === categoryTwo.id) return oldTutorial.promise;
      if (categoryId === categoryThree.id) return Promise.resolve(tutorialPage([{ ...tutorial, id: 't3', title: '最终教程', subTitle: '' }]));
      return Promise.resolve(tutorialPage());
    });
    casesMock.mockImplementation((categoryId) => {
      if (categoryId === categoryTwo.id) return oldCases.promise;
      if (categoryId === categoryThree.id) return Promise.resolve(casePage([{ ...caseItem, id: 'c3', title: '最终案例', subTitle: '' }]));
      return Promise.resolve(casePage());
    });
    renderPage();
    await screen.findByText('十分钟上手');

    activateTab('进阶实践');
    await waitFor(() => expect(screen.getByRole('tab', { name: '进阶实践' })).toHaveAttribute('data-state', 'active'));
    activateTab('专家案例');
    await waitFor(() => expect(screen.getByRole('tab', { name: '专家案例' })).toHaveAttribute('data-state', 'active'));
    expect(await screen.findByText('最终教程')).toBeInTheDocument();
    expect(screen.getByText('最终案例')).toBeInTheDocument();

    oldTutorial.resolve(tutorialPage([{ ...tutorial, id: 't2', title: '过期教程', subTitle: '' }]));
    oldCases.resolve(casePage([{ ...caseItem, id: 'c2', title: '过期案例', subTitle: '' }]));
    await waitFor(() => expect(screen.queryByText('过期教程')).not.toBeInTheDocument());
    expect(screen.queryByText('过期案例')).not.toBeInTheDocument();
  });

  it('does not request content again when the selected category is clicked', async () => {
    renderPage();
    await screen.findByText('十分钟上手');
    const tutorialCalls = tutorialsMock.mock.calls.length;
    const caseCalls = casesMock.mock.calls.length;
    activateTab('快速开始');
    expect(tutorialsMock).toHaveBeenCalledTimes(tutorialCalls);
    expect(casesMock).toHaveBeenCalledTimes(caseCalls);
  });

  it('paginates tutorials without changing the case page', async () => {
    tutorialsMock.mockImplementation((_categoryId, request) => Promise.resolve(
      request.pageNum === 2 ? tutorialPage([{ ...tutorial, id: 't2', title: '第二页教程', subTitle: '' }], 2, 7) : tutorialPage([tutorial], 1, 7),
    ));
    casesMock.mockResolvedValue(casePage([caseItem], 1, 7));
    renderPage();
    await screen.findByText('十分钟上手');
    const nextButtons = screen.getAllByRole('button', { name: '下一页' });
    fireEvent.click(nextButtons[0]);
    expect(await screen.findByText('第二页教程')).toBeInTheDocument();
    expect(tutorialsMock).toHaveBeenLastCalledWith(category.id, { pageNum: 2, pageSize: 6 });
    expect(casesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('案例副标题')).toBeInTheDocument();
  });

  it('keeps cases usable when tutorials fail and retries tutorials locally', async () => {
    tutorialsMock.mockRejectedValueOnce(new Error('教程网络错误')).mockResolvedValueOnce(tutorialPage());
    renderPage();
    expect(await screen.findByText('教程网络错误')).toBeInTheDocument();
    expect(screen.getByText('案例副标题')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('十分钟上手')).toBeInTheDocument();
    expect(casesMock).toHaveBeenCalledTimes(1);
  });

  it('opens tutorial details and clears the panel when the category changes', async () => {
    categoriesMock.mockResolvedValue({ items: [category, categoryTwo], total: 2, pageNum: 1, pageSize: 100 });
    renderPage();
    const viewButton = await screen.findByRole('button', { name: '查看教程' });
    fireEvent.click(viewButton);
    const page = document.querySelector('.learning-center-page');
    expect(page).toHaveClass('learning-center-page--detail-open');
    const panel = screen.getByRole('dialog');
    expect(panel.style.position).toBe('absolute');
    expect(panel.style.width).toBe('35.25rem');
    expect(panel.style.top).toBe('var(--sto-shell-card-gap, 0.5rem)');
    expect(panel.style.right).toBe('var(--sto-shell-card-gap, 0.5rem)');
    expect(panel.style.bottom).toBe('var(--sto-shell-card-gap, 0.5rem)');
    expect(await screen.findByRole('heading', { name: '教程正文' })).toBeInTheDocument();
    activateTab('进阶实践', true);
    await waitFor(() => expect(screen.queryByRole('heading', { name: '教程正文' })).not.toBeInTheDocument());
    expect(document.querySelector('.learning-center-page')).not.toHaveClass('learning-center-page--detail-open');
  });

  it('shows a forbidden detail state without rendering tutorial content', async () => {
    tutorialDetailMock.mockRejectedValue(new LearningCenterApiError('没有教程权限', '403'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '查看教程' }));
    expect(await screen.findByText('没有教程权限')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '教程正文' })).not.toBeInTheDocument();
  });

  it('retries tutorial details locally and restores focus after closing', async () => {
    tutorialDetailMock.mockRejectedValueOnce(new Error('详情网络错误')).mockResolvedValueOnce(tutorial);
    renderPage();
    const viewButton = await screen.findByRole('button', { name: '查看教程' });
    fireEvent.click(viewButton);
    expect(await screen.findByText('详情网络错误')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByRole('heading', { name: '教程正文' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '教程正文' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(viewButton));
  });

  it('retries after the learning center shell fails', async () => {
    domainsMock.mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValueOnce({ items: [], total: 0, pageNum: 1, pageSize: 20 });
    renderPage();
    expect(await screen.findByText('网络不可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(domainsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('暂无可见学习内容')).toBeInTheDocument();
  });
});
