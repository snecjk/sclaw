import { hostApiFetch } from '@/lib/host-api';

export interface TutorialDetail {
  id: number;
  categoryId: number;
  tutorialCode: string;
  name: string;
  title: string;
  subTitle: string;
  description: string;
  contentType: string;
  contentImageUrl: string;
  content: string | null;
  contentRefCode: string;
  status: string;
  sortOrder: number | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  errCode?: string;
  errMessage?: string;
  data?: T;
}

export class LearningCenterApiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'LearningCenterApiError';
  }
}

export async function getTutorialDetail(tutorialId: number): Promise<TutorialDetail> {
  const response = await hostApiFetch<ApiEnvelope<TutorialDetail>>('/api/learning-center/tutorial/detail', {
    method: 'POST',
    body: JSON.stringify({ data: { tutorialId } }),
  });
  if (!response.success || !response.data) {
    throw new LearningCenterApiError(response.errMessage || '教程加载失败', response.errCode);
  }
  return response.data;
}
