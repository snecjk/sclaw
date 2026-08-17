import { hostApiFetch } from '@/lib/host-api';
import type {
  LearningCaseAction,
  LearningCaseDetail,
  LearningCaseTargetType,
  LearningCaseTemplate,
  LearningCategory,
  LearningCenterId,
  LearningCenterIdInput,
  LearningContentType,
  LearningDomain,
  LearningPage,
  LearningPageRequest,
  LearningPromptMode,
  LearningResourceStatus,
  LearningTutorial,
} from '@/types/learning-center';

type UnknownRecord = Record<string, unknown>;

interface ApiEnvelope {
  success?: boolean;
  errCode?: unknown;
  errMessage?: unknown;
  code?: unknown;
  message?: unknown;
  data?: unknown;
}

export type TutorialDetail = LearningTutorial;

export class LearningCenterApiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'LearningCenterApiError';
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(record: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function asNullableString(value: unknown): string | null {
  return value == null ? null : asString(value);
}

function asInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function asNonNegativeInteger(value: unknown, fallback = 0): number {
  return Math.max(0, asInteger(value, fallback));
}

function asSortOrder(value: unknown): number | null {
  return value == null || value === '' ? null : asNonNegativeInteger(value);
}

function asId(value: unknown, field: string): LearningCenterId {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new LearningCenterApiError(`${field} must be returned as a string to preserve ID precision`, 'ID_PRECISION_LOSS');
    }
    return String(value);
  }
  throw new LearningCenterApiError(`Learning center response is missing ${field}`, 'INVALID_RESPONSE');
}

function asNullableId(value: unknown, field: string): LearningCenterId | null {
  return value == null || value === '' ? null : asId(value, field);
}

function asStatus(value: unknown): { value: LearningResourceStatus; raw: string } {
  const raw = asString(value).toUpperCase();
  const known: LearningResourceStatus[] = ['DRAFT', 'PUBLISHED', 'DISABLED'];
  return { value: known.includes(raw as LearningResourceStatus) ? raw as LearningResourceStatus : 'UNKNOWN', raw };
}

function asContentType(value: unknown): { value: LearningContentType; raw: string } {
  const raw = asString(value).toUpperCase();
  const known: LearningContentType[] = ['IMAGE', 'RICH_TEXT', 'PORTAL_ARTICLE'];
  return { value: known.includes(raw as LearningContentType) ? raw as LearningContentType : 'UNKNOWN', raw };
}

function asTargetType(value: unknown): { value: LearningCaseTargetType; raw: string } {
  const raw = asString(value).toUpperCase();
  const known: LearningCaseTargetType[] = ['SKILL', 'CONNECTOR', 'APP', 'WORKFLOW', 'URL', 'CHAT'];
  return { value: known.includes(raw as LearningCaseTargetType) ? raw as LearningCaseTargetType : 'UNKNOWN', raw };
}

function asPromptMode(value: unknown): { value: LearningPromptMode; raw: string } {
  const raw = asString(value).toUpperCase();
  const known: LearningPromptMode[] = ['REPLACE', 'APPEND'];
  return { value: known.includes(raw as LearningPromptMode) ? raw as LearningPromptMode : 'UNKNOWN', raw };
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new LearningCenterApiError(`${label} has an invalid response shape`, 'INVALID_RESPONSE');
  }
  return value;
}

function normalizeDomain(value: unknown): LearningDomain {
  const record = requireRecord(value, 'Learning domain');
  const status = asStatus(pick(record, 'status'));
  return {
    id: asId(pick(record, 'id', 'domainId', 'domain_id'), 'domain.id'),
    domainCode: asString(pick(record, 'domainCode', 'domain_code')),
    name: asString(record.name),
    mainTitle: asString(pick(record, 'mainTitle', 'main_title')),
    subTitle: asString(pick(record, 'subTitle', 'sub_title')),
    description: asString(record.description),
    coverImageUrl: asString(pick(record, 'coverImageUrl', 'cover_image_url')),
    status: status.value,
    statusRaw: status.raw,
    sortOrder: asSortOrder(pick(record, 'sortOrder', 'sort_order')),
  };
}

function normalizeCategory(value: unknown): LearningCategory {
  const record = requireRecord(value, 'Learning category');
  const status = asStatus(record.status);
  return {
    id: asId(pick(record, 'id', 'categoryId', 'category_id'), 'category.id'),
    domainId: asId(pick(record, 'domainId', 'domain_id'), 'category.domainId'),
    categoryCode: asString(pick(record, 'categoryCode', 'category_code')),
    name: asString(record.name),
    title: asString(record.title),
    subTitle: asString(pick(record, 'subTitle', 'sub_title')),
    description: asString(record.description),
    imageUrl: asString(pick(record, 'imageUrl', 'image_url')),
    status: status.value,
    statusRaw: status.raw,
    sortOrder: asSortOrder(pick(record, 'sortOrder', 'sort_order')),
  };
}

function normalizeTutorial(value: unknown): LearningTutorial {
  const record = requireRecord(value, 'Learning tutorial');
  const status = asStatus(record.status);
  const contentType = asContentType(pick(record, 'contentType', 'content_type'));
  return {
    id: asId(pick(record, 'id', 'tutorialId', 'tutorial_id'), 'tutorial.id'),
    categoryId: asId(pick(record, 'categoryId', 'category_id'), 'tutorial.categoryId'),
    tutorialCode: asString(pick(record, 'tutorialCode', 'tutorial_code')),
    name: asString(record.name),
    title: asString(record.title),
    subTitle: asString(pick(record, 'subTitle', 'sub_title')),
    description: asString(record.description),
    contentType: contentType.value,
    contentTypeRaw: contentType.raw,
    contentImageUrl: asString(pick(record, 'contentImageUrl', 'content_image_url')),
    content: asNullableString(record.content),
    contentRefCode: asString(pick(record, 'contentRefCode', 'content_ref_code')),
    status: status.value,
    statusRaw: status.raw,
    sortOrder: asSortOrder(pick(record, 'sortOrder', 'sort_order')),
  };
}

function normalizeCaseTemplate(value: unknown): LearningCaseTemplate {
  const record = requireRecord(value, 'Learning case template');
  const status = asStatus(record.status);
  const targetType = asTargetType(pick(record, 'targetType', 'target_type'));
  const promptMode = asPromptMode(pick(record, 'promptMode', 'prompt_mode'));
  const rawTutorialIds = pick(record, 'tutorialIds', 'tutorial_ids');
  return {
    id: asId(pick(record, 'id', 'caseId', 'case_id'), 'case.id'),
    categoryId: asId(pick(record, 'categoryId', 'category_id'), 'case.categoryId'),
    tutorialId: asNullableId(pick(record, 'tutorialId', 'tutorial_id'), 'case.tutorialId'),
    tutorialIds: Array.isArray(rawTutorialIds)
      ? rawTutorialIds.map((id, index) => asId(id, `case.tutorialIds[${index}]`))
      : [],
    caseCode: asString(pick(record, 'caseCode', 'case_code')),
    name: asString(record.name),
    title: asString(record.title),
    subTitle: asString(pick(record, 'subTitle', 'sub_title')),
    description: asString(record.description),
    coverImageUrl: asString(pick(record, 'coverImageUrl', 'cover_image_url')),
    sceneTitle: asString(pick(record, 'sceneTitle', 'scene_title')),
    sceneDescription: asString(pick(record, 'sceneDescription', 'scene_description')),
    targetType: targetType.value,
    targetTypeRaw: targetType.raw,
    targetCode: asString(pick(record, 'targetCode', 'target_code')),
    targetUrl: asString(pick(record, 'targetUrl', 'target_url')),
    promptText: asNullableString(pick(record, 'promptText', 'prompt_text')),
    promptMode: promptMode.value,
    promptModeRaw: promptMode.raw,
    actionText: asString(pick(record, 'actionText', 'action_text')),
    useCount: asNonNegativeInteger(pick(record, 'useCount', 'use_count')),
    status: status.value,
    statusRaw: status.raw,
    sortOrder: asSortOrder(pick(record, 'sortOrder', 'sort_order')),
  };
}

function normalizePage<T>(value: unknown, normalizeItem: (item: unknown) => T): LearningPage<T> {
  const record = requireRecord(value, 'Learning center page');
  const rawItems = pick(record, 'items', 'records', 'list');
  const items = Array.isArray(rawItems) ? rawItems.map(normalizeItem) : [];
  return {
    items,
    total: asNonNegativeInteger(record.total, items.length),
    pageNum: Math.max(1, asInteger(pick(record, 'pageNum', 'page_num'), 1)),
    pageSize: Math.max(1, asInteger(pick(record, 'pageSize', 'page_size'), Math.max(items.length, 1))),
  };
}

function normalizePageRequest(request: LearningPageRequest = {}): Required<LearningPageRequest> {
  return {
    pageNum: Math.max(1, asInteger(request.pageNum, 1)),
    pageSize: Math.min(100, Math.max(1, asInteger(request.pageSize, 20))),
  };
}

function normalizeRequestId(value: LearningCenterIdInput, field: string): LearningCenterId {
  return asId(value, field);
}

async function postData<T>(path: string, data: UnknownRecord, normalize: (value: unknown) => T): Promise<T> {
  const response = await hostApiFetch<ApiEnvelope>(path, {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
  if (!isRecord(response)) {
    throw new LearningCenterApiError('Learning center returned an invalid envelope', 'INVALID_RESPONSE');
  }
  if (response.success !== true) {
    const code = asString(response.errCode ?? response.code) || undefined;
    const message = asString(response.errMessage ?? response.message, 'Learning center request failed');
    throw new LearningCenterApiError(message, code);
  }
  return normalize(response.data);
}

export function pageLearningDomains(request: LearningPageRequest = {}): Promise<LearningPage<LearningDomain>> {
  return postData('/api/learning-center/domain/page', normalizePageRequest(request), (data) => normalizePage(data, normalizeDomain));
}

export function pageLearningCategories(domainId: LearningCenterIdInput, request: LearningPageRequest = {}): Promise<LearningPage<LearningCategory>> {
  return postData('/api/learning-center/category/page', {
    domainId: normalizeRequestId(domainId, 'domainId'),
    ...normalizePageRequest(request),
  }, (data) => normalizePage(data, normalizeCategory));
}

export function pageLearningTutorials(categoryId: LearningCenterIdInput, request: LearningPageRequest = {}): Promise<LearningPage<LearningTutorial>> {
  return postData('/api/learning-center/tutorial/page', {
    categoryId: normalizeRequestId(categoryId, 'categoryId'),
    ...normalizePageRequest(request),
  }, (data) => normalizePage(data, normalizeTutorial));
}

export function pageLearningCases(categoryId: LearningCenterIdInput, request: LearningPageRequest = {}): Promise<LearningPage<LearningCaseTemplate>> {
  return postData('/api/learning-center/case-template/page', {
    categoryId: normalizeRequestId(categoryId, 'categoryId'),
    ...normalizePageRequest(request),
  }, (data) => normalizePage(data, normalizeCaseTemplate));
}

export function getTutorialDetail(tutorialId: LearningCenterIdInput): Promise<LearningTutorial> {
  return postData('/api/learning-center/tutorial/detail', {
    tutorialId: normalizeRequestId(tutorialId, 'tutorialId'),
  }, normalizeTutorial);
}

export function getCaseDetail(caseId: LearningCenterIdInput): Promise<LearningCaseDetail> {
  return postData('/api/learning-center/case-template/detail', {
    caseId: normalizeRequestId(caseId, 'caseId'),
  }, (value) => {
    const record = requireRecord(value, 'Learning case detail');
    return {
      ...normalizeCaseTemplate(record),
      tutorial: record.tutorial == null ? null : normalizeTutorial(record.tutorial),
      tutorials: Array.isArray(record.tutorials) ? record.tutorials.map(normalizeTutorial) : [],
    };
  });
}

export function useLearningCase(caseId: LearningCenterIdInput): Promise<LearningCaseAction> {
  return postData('/api/learning-center/case-template/use', {
    caseId: normalizeRequestId(caseId, 'caseId'),
  }, (value) => {
    const record = requireRecord(value, 'Learning case action');
    const targetType = asTargetType(pick(record, 'targetType', 'target_type'));
    const promptMode = asPromptMode(pick(record, 'promptMode', 'prompt_mode'));
    return {
      targetType: targetType.value,
      targetTypeRaw: targetType.raw,
      targetCode: asString(pick(record, 'targetCode', 'target_code')),
      targetUrl: asString(pick(record, 'targetUrl', 'target_url')),
      promptText: asNullableString(pick(record, 'promptText', 'prompt_text')),
      promptMode: promptMode.value,
      promptModeRaw: promptMode.raw,
      useCount: asNonNegativeInteger(pick(record, 'useCount', 'use_count')),
    };
  });
}
