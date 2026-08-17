import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ContentHeaderProvider } from '@/components/layout/content-header-context';
import { LearningCenterPage } from '@/pages/LearningCenter/LearningCenterPage';
import { pageLearningCategories, pageLearningDomains } from '@/lib/learning-center-api';

vi.mock('@/lib/learning-center-api', () => ({
  pageLearningDomains: vi.fn(),
  pageLearningCategories: vi.fn(),
}));

const domainsMock = vi.mocked(pageLearningDomains);
const categoriesMock = vi.mocked(pageLearningCategories);

const domain = {
  id: '90071992547409930', domainCode: 'AI', name: 'AI 学习中心', mainTitle: 'AI 成长中心',
  subTitle: '从教程到实践', description: '学习描述', coverImageUrl: '', status: 'PUBLISHED' as const,
  statusRaw: 'PUBLISHED', sortOrder: 0,
};
const category = {
  id: '90071992547409931', domainId: domain.id, categoryCode: 'START', name: '快速开始', title: '快速开始',
  subTitle: '', description: '', imageUrl: '', status: 'PUBLISHED' as const, statusRaw: 'PUBLISHED', sortOrder: 0,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/learning-center']}>
      <ContentHeaderProvider>
        <LearningCenterPage />
      </ContentHeaderProvider>
    </MemoryRouter>,
  );
}

describe('LearningCenterPage shell', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    domainsMock.mockReset();
    categoriesMock.mockReset();
  });

  it('loads the first visible domain and its categories', async () => {
    domainsMock.mockResolvedValue({ items: [domain], total: 1, pageNum: 1, pageSize: 20 });
    categoriesMock.mockResolvedValue({ items: [category], total: 1, pageNum: 1, pageSize: 100 });
    renderPage();

    expect(screen.getByText('正在加载学习中心')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'AI 成长中心' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '快速开始' })).toHaveAttribute('data-state', 'active');
    expect(categoriesMock).toHaveBeenCalledWith(domain.id, { pageNum: 1, pageSize: 100 });
  });

  it('shows a domain empty state without requesting categories', async () => {
    domainsMock.mockResolvedValue({ items: [], total: 0, pageNum: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('暂无可见学习内容')).toBeInTheDocument();
    expect(categoriesMock).not.toHaveBeenCalled();
  });

  it('shows a category empty state while retaining the domain header', async () => {
    domainsMock.mockResolvedValue({ items: [domain], total: 1, pageNum: 1, pageSize: 20 });
    categoriesMock.mockResolvedValue({ items: [], total: 0, pageNum: 1, pageSize: 100 });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'AI 成长中心' })).toBeInTheDocument();
    expect(screen.getByText('这个学习域还没有分类')).toBeInTheDocument();
  });

  it('retries after a load failure', async () => {
    domainsMock
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce({ items: [], total: 0, pageNum: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('网络不可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(domainsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('暂无可见学习内容')).toBeInTheDocument();
  });
});
