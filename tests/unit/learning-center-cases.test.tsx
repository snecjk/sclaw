import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ContentHeaderProvider } from '@/components/layout/content-header-context';
import { LearningCenterPage } from '@/pages/LearningCenter/LearningCenterPage';
import { dispatchLearningCaseAction } from '@/lib/learning-case-action';
import {
  getCaseDetail,
  getTutorialDetail,
  pageLearningCases,
  pageLearningCategories,
  pageLearningDomains,
  pageLearningTutorials,
  useLearningCase,
} from '@/lib/learning-center-api';
import type { LearningCaseAction, LearningCaseDetail } from '@/types/learning-center';

vi.mock('@/lib/learning-center-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/learning-center-api')>();
  return {
    ...actual,
    pageLearningDomains: vi.fn(),
    pageLearningCategories: vi.fn(),
    pageLearningTutorials: vi.fn(),
    pageLearningCases: vi.fn(),
    getTutorialDetail: vi.fn(),
    getCaseDetail: vi.fn(),
    useLearningCase: vi.fn(),
  };
});

vi.mock('@/lib/learning-case-action', () => ({
  dispatchLearningCaseAction: vi.fn(() => ({ ok: true, navigatedTo: '/', draftApplied: true })),
}));

vi.mock('@/lib/learning-case-chip-title', () => ({
  resolveLearningCaseChipTitle: vi.fn(async (action: { targetType: string }) => {
    if (action.targetType === 'SKILL') return '财务-看报表';
    if (action.targetType === 'WORKFLOW') return '报价测算';
    return undefined;
  }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const domainsMock = vi.mocked(pageLearningDomains);
const categoriesMock = vi.mocked(pageLearningCategories);
const tutorialsMock = vi.mocked(pageLearningTutorials);
const casesMock = vi.mocked(pageLearningCases);
const tutorialDetailMock = vi.mocked(getTutorialDetail);
const caseDetailMock = vi.mocked(getCaseDetail);
const useCaseMock = vi.mocked(useLearningCase);
const dispatchMock = vi.mocked(dispatchLearningCaseAction);

const domain = {
  id: '90071992547409930', domainCode: 'AI', name: 'AI 学习中心', mainTitle: 'AI 成长中心',
  subTitle: '从教程到实践', description: '学习描述', coverImageUrl: '', status: 'PUBLISHED' as const,
  statusRaw: 'PUBLISHED', sortOrder: 0,
};
const category = {
  id: '90071992547409931', domainId: domain.id, categoryCode: 'START', name: '快速开始', title: '快速开始',
  subTitle: '', description: '', imageUrl: '', status: 'PUBLISHED' as const, statusRaw: 'PUBLISHED', sortOrder: 0,
};
const tutorial = {
  id: '91000000000000001', categoryId: category.id, tutorialCode: 'T1', name: '入门教程', title: '入门教程',
  subTitle: '十分钟上手', description: '教程简介', contentType: 'RICH_TEXT' as const, contentTypeRaw: 'RICH_TEXT',
  contentImageUrl: '', content: '<h2>教程正文</h2>', contentRefCode: '', status: 'PUBLISHED' as const,
  statusRaw: 'PUBLISHED', sortOrder: 0,
};
const caseItem = {
  id: '92000000000000001', categoryId: category.id, tutorialId: tutorial.id, tutorialIds: [tutorial.id],
  caseCode: 'C1', name: '周报自动汇总', title: '周报自动汇总', subTitle: '案例副标题', description: '案例简介',
  coverImageUrl: 'https://oss.example.com/cover.png?sig=abc',
  sceneTitle: '周报场景', sceneDescription: '每周五自动汇总', targetType: 'CHAT' as const, targetTypeRaw: 'CHAT',
  targetCode: '', targetUrl: '', promptText: '帮我写周报', promptMode: 'REPLACE' as const, promptModeRaw: 'REPLACE',
  actionText: '立即使用', useCount: 7, status: 'PUBLISHED' as const, statusRaw: 'PUBLISHED', sortOrder: 0,
};

const caseDetail: LearningCaseDetail = { ...caseItem, tutorial, tutorials: [tutorial] };

const caseAction: LearningCaseAction = {
  targetType: 'CHAT', targetTypeRaw: 'CHAT', targetCode: '', targetUrl: '',
  promptText: '帮我写周报', promptMode: 'REPLACE', promptModeRaw: 'REPLACE', useCount: 8,
};

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

async function useCaseFromCard() {
  fireEvent.click(await screen.findByRole('button', { name: '立即使用' }));
}

describe('LearningCenterPage cases', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    vi.clearAllMocks();
    domainsMock.mockResolvedValue({ items: [domain], total: 1, pageNum: 1, pageSize: 20 });
    categoriesMock.mockResolvedValue({ items: [category], total: 1, pageNum: 1, pageSize: 100 });
    tutorialsMock.mockResolvedValue({ items: [tutorial], total: 1, pageNum: 1, pageSize: 6 });
    casesMock.mockResolvedValue({ items: [caseItem], total: 1, pageNum: 1, pageSize: 6 });
    tutorialDetailMock.mockResolvedValue(tutorial);
    caseDetailMock.mockResolvedValue(caseDetail);
    useCaseMock.mockResolvedValue(caseAction);
    dispatchMock.mockReturnValue({ ok: true, navigatedTo: '/', draftApplied: true });
  });

  it('renders the server facts on the case card', async () => {
    renderPage();
    expect(await screen.findByText('周报自动汇总')).toBeInTheDocument();
    expect(screen.getByText('案例副标题')).toBeInTheDocument();
    expect(screen.getByLabelText('已被使用 7 次')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即使用' })).toBeInTheDocument();
    expect(await screen.findByText('周报自动汇总')).toBeInTheDocument();
    expect(screen.getByAltText('周报自动汇总 封面')).toHaveAttribute('src', caseItem.coverImageUrl);
  });

  it('shows the case empty state while tutorials stay usable', async () => {
    casesMock.mockResolvedValue({ items: [], total: 0, pageNum: 1, pageSize: 6 });
    renderPage();
    expect(await screen.findByText('案例模版努力扩充中')).toBeInTheDocument();
    expect(screen.queryByText('暂无实践案例')).not.toBeInTheDocument();
    expect(screen.queryByText('这个分类还没有发布实践案例。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看教程' })).toBeInTheDocument();
  });

  it('shows the tutorial empty state without the old inbox copy', async () => {
    tutorialsMock.mockResolvedValue({ items: [], total: 0, pageNum: 1, pageSize: 6 });
    renderPage();
    expect(await screen.findByText('教程努力扩充中')).toBeInTheDocument();
    expect(screen.queryByText('暂无教程')).not.toBeInTheDocument();
    expect(screen.queryByText('这个分类还没有发布教程。')).not.toBeInTheDocument();
  });

  it('keeps the cover img after a renderer load error so the host fetch can replace src', async () => {
    renderPage();
    const cover = await screen.findByAltText('周报自动汇总 封面');
    fireEvent.error(cover);
    expect(screen.getByAltText('周报自动汇总 封面')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即使用' })).toBeInTheDocument();
  });

  it('opens case details without calling the use endpoint', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '查看详情' }));
    const dialog = await screen.findByRole('dialog', { name: '周报自动汇总' });
    expect(within(dialog).getByText('点击「立即使用」后将填入首页对话框，可再修改后发送')).toBeInTheDocument();
    expect(within(dialog).getByText('场景说明')).toBeInTheDocument();
    expect(within(dialog).getByText('每周五自动汇总')).toBeInTheDocument();
    expect(within(dialog).getByText('提示词')).toBeInTheDocument();
    expect(within(dialog).getByText('帮我写周报')).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: '教程正文' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '立即使用' })).toBeInTheDocument();
    expect(useCaseMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('已被使用 7 次')).toBeInTheDocument();
  });

  it('retries case details locally after a failure', async () => {
    caseDetailMock.mockRejectedValueOnce(new Error('案例详情网络错误')).mockResolvedValueOnce(caseDetail);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '查看详情' }));
    expect(await screen.findByText('案例详情网络错误')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('每周五自动汇总')).toBeInTheDocument();
    expect(useCaseMock).not.toHaveBeenCalled();
  });

  it('uses the case immediately without a second confirm dialog', async () => {
    renderPage();
    await useCaseFromCard();
    await waitFor(() => expect(useCaseMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: '确认使用这个案例？' })).not.toBeInTheDocument();
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a single use request while the first click is in flight', async () => {
    const pending = deferred<LearningCaseAction>();
    useCaseMock.mockReturnValue(pending.promise);
    renderPage();
    const trigger = await screen.findByRole('button', { name: '立即使用' });

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(useCaseMock).toHaveBeenCalledTimes(1);

    pending.resolve(caseAction);
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
  });

  it('updates the use count from the server response and dispatches the action', async () => {
    renderPage();
    await useCaseFromCard();

    expect(await screen.findByLabelText('已被使用 8 次')).toBeInTheDocument();
    expect(dispatchMock).toHaveBeenCalledWith(caseAction, expect.objectContaining({
      navigate: expect.any(Function),
      displayTitle: undefined,
    }));
    expect(toastSuccess).toHaveBeenCalledWith('已为你打开案例入口');
  });

  it('passes the resolved skill name rather than the case template title', async () => {
    const skillCase = {
      ...caseItem,
      title: '报价导入',
      name: '报价导入',
      targetType: 'SKILL' as const,
      targetTypeRaw: 'SKILL',
      targetCode: 'finance-guanbao',
    };
    const skillAction: LearningCaseAction = {
      ...caseAction,
      targetType: 'SKILL',
      targetTypeRaw: 'SKILL',
      targetCode: 'finance-guanbao',
      promptText: '帮我做报价测算',
    };
    casesMock.mockResolvedValue({ items: [skillCase], total: 1, pageNum: 1, pageSize: 6 });
    useCaseMock.mockResolvedValue(skillAction);

    renderPage();
    await useCaseFromCard();
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith(
      skillAction,
      expect.objectContaining({ displayTitle: '财务-看报表' }),
    ));
  });

  it('keeps the list, count and navigation unchanged when the use request fails', async () => {
    useCaseMock.mockRejectedValue(new Error('案例已下线'));
    renderPage();
    await useCaseFromCard();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('案例已下线'));
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('已被使用 7 次')).toBeInTheDocument();
  });

  it('keeps learning center overlays mutually exclusive', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '查看教程' }));
    expect(await screen.findByRole('dialog', { name: '教程指南' })).toBeInTheDocument();

    // The tutorial sheet is non-modal, so the case card stays clickable while reading.
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    await screen.findByRole('dialog', { name: '周报自动汇总' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '教程指南' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '周报自动汇总' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '查看教程' }));
    expect(await screen.findByRole('dialog', { name: '教程指南' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '立即使用' }));
    await waitFor(() => expect(useCaseMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: '确认使用这个案例？' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '教程指南' })).not.toBeInTheDocument());
  });

  it('surfaces a degraded action without pretending the case opened', async () => {
    dispatchMock.mockReturnValue({ ok: false, reason: 'UNSUPPORTED_TARGET' });
    renderPage();
    await useCaseFromCard();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('暂不支持这个案例的跳转类型，请联系管理员。'));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('已被使用 8 次')).toBeInTheDocument();
  });
});
