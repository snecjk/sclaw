import { memoryCenterFetchForSession } from './sto-memory-api-fetch';

export interface LearningCenterTutorialDetail {
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

export function getLearningCenterTutorialDetail(tutorialId: number): Promise<unknown> {
  return memoryCenterFetchForSession('/api/v1/learning-center/tutorial/detail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { tutorialId } }),
  });
}
