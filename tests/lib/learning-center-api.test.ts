import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTutorialDetail, LearningCenterApiError } from '@/lib/learning-center-api';
import { hostApiFetch } from '@/lib/host-api';

vi.mock('@/lib/host-api', () => ({ hostApiFetch: vi.fn() }));
const mockedFetch = vi.mocked(hostApiFetch);

describe('learning-center-api', () => {
  beforeEach(() => mockedFetch.mockReset());

  it('uses POST data envelope and returns refreshed content unchanged', async () => {
    const content = '<img src="https://oss/a.png?Expires=new&Signature=renewed">';
    mockedFetch.mockResolvedValue({ success: true, data: { id: 7, content } });
    const result = await getTutorialDetail(7);
    expect(mockedFetch).toHaveBeenCalledWith('/api/learning-center/tutorial/detail', {
      method: 'POST',
      body: JSON.stringify({ data: { tutorialId: 7 } }),
    });
    expect(result.content).toBe(content);
  });

  it('maps permission and backend failures without returning content', async () => {
    mockedFetch.mockResolvedValue({ success: false, errCode: '403', errMessage: '暂无权限', data: null });
    await expect(getTutorialDetail(7)).rejects.toEqual(expect.objectContaining<Partial<LearningCenterApiError>>({ code: '403', message: '暂无权限' }));
  });
});
