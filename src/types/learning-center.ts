export type LearningCenterId = string;
export type LearningCenterIdInput = string | number;

export type LearningResourceStatus = 'DRAFT' | 'PUBLISHED' | 'DISABLED' | 'UNKNOWN';
export type LearningContentType = 'IMAGE' | 'RICH_TEXT' | 'PORTAL_ARTICLE' | 'UNKNOWN';
export type LearningCaseTargetType = 'SKILL' | 'CONNECTOR' | 'APP' | 'WORKFLOW' | 'URL' | 'CHAT' | 'UNKNOWN';
export type LearningPromptMode = 'REPLACE' | 'APPEND' | 'UNKNOWN';

export interface LearningPageRequest {
  pageNum?: number;
  pageSize?: number;
}

export interface LearningPage<T> {
  items: T[];
  total: number;
  pageNum: number;
  pageSize: number;
}

export interface LearningDomain {
  id: LearningCenterId;
  domainCode: string;
  name: string;
  mainTitle: string;
  subTitle: string;
  description: string;
  coverImageUrl: string;
  status: LearningResourceStatus;
  statusRaw: string;
  sortOrder: number | null;
}

export interface LearningCategory {
  id: LearningCenterId;
  domainId: LearningCenterId;
  categoryCode: string;
  name: string;
  title: string;
  subTitle: string;
  description: string;
  imageUrl: string;
  status: LearningResourceStatus;
  statusRaw: string;
  sortOrder: number | null;
}

export interface LearningTutorial {
  id: LearningCenterId;
  categoryId: LearningCenterId;
  tutorialCode: string;
  name: string;
  title: string;
  subTitle: string;
  description: string;
  contentType: LearningContentType;
  contentTypeRaw: string;
  contentImageUrl: string;
  content: string | null;
  contentRefCode: string;
  status: LearningResourceStatus;
  statusRaw: string;
  sortOrder: number | null;
}

export interface LearningCaseTemplate {
  id: LearningCenterId;
  categoryId: LearningCenterId;
  tutorialId: LearningCenterId | null;
  tutorialIds: LearningCenterId[];
  caseCode: string;
  name: string;
  title: string;
  subTitle: string;
  description: string;
  coverImageUrl: string;
  sceneTitle: string;
  sceneDescription: string;
  targetType: LearningCaseTargetType;
  targetTypeRaw: string;
  targetCode: string;
  targetUrl: string;
  promptText: string | null;
  promptMode: LearningPromptMode;
  promptModeRaw: string;
  actionText: string;
  useCount: number;
  status: LearningResourceStatus;
  statusRaw: string;
  sortOrder: number | null;
}

export interface LearningCaseDetail extends LearningCaseTemplate {
  tutorial: LearningTutorial | null;
  tutorials: LearningTutorial[];
}

export interface LearningCaseAction {
  targetType: LearningCaseTargetType;
  targetTypeRaw: string;
  targetCode: string;
  targetUrl: string;
  promptText: string | null;
  promptMode: LearningPromptMode;
  promptModeRaw: string;
  useCount: number;
}
