import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCaseDetail,
  getTutorialDetail,
  LearningCenterApiError,
  pageLearningCases,
  pageLearningCategories,
  pageLearningDomains,
  pageLearningTutorials,
  useLearningCase,
} from '@/lib/learning-center-api';
import { hostApiFetch } from '@/lib/host-api';

vi.mock('@/lib/host-api', () => ({ hostApiFetch: vi.fn() }));
const mockedFetch = vi.mocked(hostApiFetch);

const domain = {
  id: '9223372036854775807', domainCode: 'AI', name: 'AI 学习中心', mainTitle: 'AI 学习中心',
  subTitle: null, description: null, coverImageUrl: null, status: 'PUBLISHED', sortOrder: 0,
};
const category = {
  id: '9223372036854775806', domainId: domain.id, categoryCode: 'START', name: '快速开始',
  title: '快速开始', subTitle: '', description: '', imageUrl: '', status: 'PUBLISHED', sortOrder: 1,
};
const tutorial = {
  id: '9223372036854775805', categoryId: category.id, tutorialCode: 'WELCOME', name: '欢迎',
  title: '欢迎使用', subTitle: '', description: '', contentType: 'RICH_TEXT', contentImageUrl: '',
  content: '<p>hello</p>', contentRefCode: '', status: 'PUBLISHED', sortOrder: 1,
};
const caseTemplate = {
  id: '9223372036854775804', categoryId: category.id, tutorialId: tutorial.id,
  tutorialIds: [tutorial.id], caseCode: 'CASE', name: '示例', title: '示例', subTitle: null,
  description: null, coverImageUrl: null, sceneTitle: null, sceneDescription: null,
  targetType: 'SKILL', targetCode: 'skill-code', targetUrl: '', promptText: null,
  promptMode: 'REPLACE', actionText: '立即使用', useCount: 3, status: 'PUBLISHED', sortOrder: null,
};

describe('learning-center-api', () => {
  beforeEach(() => mockedFetch.mockReset());

  it('normalizes all four page contracts and preserves string IDs', async () => {
    mockedFetch
      .mockResolvedValueOnce({ success: true, data: { items: [domain], total: 1, pageNum: 1, pageSize: 20 } })
      .mockResolvedValueOnce({ success: true, data: { records: [{ ...category, domain_id: category.domainId, domainId: undefined }], total: 1, page_num: 1, page_size: 20 } })
      .mockResolvedValueOnce({ success: true, data: { items: [tutorial], total: 1, pageNum: 1, pageSize: 20 } })
      .mockResolvedValueOnce({ success: true, data: { list: [caseTemplate], total: 1, pageNum: 1, pageSize: 20 } });

    const domains = await pageLearningDomains();
    const categories = await pageLearningCategories(domain.id);
    const tutorials = await pageLearningTutorials(category.id);
    const cases = await pageLearningCases(category.id);

    expect(domains.items[0]?.id).toBe(domain.id);
    expect(domains.items[0]?.subTitle).toBe('');
    expect(categories.items[0]?.domainId).toBe(domain.id);
    expect(tutorials.items[0]?.content).toBe('<p>hello</p>');
    expect(cases.items[0]?.tutorialIds).toEqual([tutorial.id]);
    expect(mockedFetch).toHaveBeenNthCalledWith(2, '/api/learning-center/category/page', {
      method: 'POST', body: JSON.stringify({ data: { domainId: domain.id, pageNum: 1, pageSize: 20 } }),
    });
  });

  it('uses POST data envelopes for detail and use routes', async () => {
    mockedFetch
      .mockResolvedValueOnce({ success: true, data: tutorial })
      .mockResolvedValueOnce({ success: true, data: { ...caseTemplate, tutorial, tutorials: [tutorial] } })
      .mockResolvedValueOnce({ success: true, data: {
        targetType: 'CHAT', targetCode: '', targetUrl: '', promptText: 'hello', promptMode: 'APPEND', useCount: 4,
      } });

    expect((await getTutorialDetail(tutorial.id)).id).toBe(tutorial.id);
    expect((await getCaseDetail(caseTemplate.id)).tutorials).toHaveLength(1);
    expect((await useLearningCase(caseTemplate.id)).promptMode).toBe('APPEND');
    expect(mockedFetch).toHaveBeenNthCalledWith(3, '/api/learning-center/case-template/use', {
      method: 'POST', body: JSON.stringify({ data: { caseId: caseTemplate.id } }),
    });
  });

  it('maps unknown enums to UNKNOWN while retaining the raw value', async () => {
    mockedFetch.mockResolvedValue({ success: true, data: {
      items: [{
        ...caseTemplate, target_type: 'DEVICE', targetType: undefined, prompt_mode: 'MERGE', promptMode: undefined,
        status: 'ARCHIVED',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    } });
    const result = await pageLearningCases(category.id);
    expect(result.items[0]).toMatchObject({
      targetType: 'UNKNOWN', targetTypeRaw: 'DEVICE', promptMode: 'UNKNOWN', promptModeRaw: 'MERGE',
      status: 'UNKNOWN', statusRaw: 'ARCHIVED',
    });
  });

  it('rejects unsafe numeric IDs instead of silently using a rounded resource ID', async () => {
    mockedFetch.mockResolvedValue({ success: true, data: {
      items: [{ ...domain, id: 9_223_372_036_854_776_000 }], total: 1, pageNum: 1, pageSize: 20,
    } });
    await expect(pageLearningDomains()).rejects.toEqual(expect.objectContaining<Partial<LearningCenterApiError>>({
      code: 'ID_PRECISION_LOSS',
    }));
  });

  it('maps permission and backend failures without returning content', async () => {
    mockedFetch.mockResolvedValue({ success: false, errCode: '403', errMessage: '暂无权限', data: null });
    await expect(getTutorialDetail('7')).rejects.toEqual(expect.objectContaining<Partial<LearningCenterApiError>>({
      code: '403', message: '暂无权限',
    }));
  });
});
