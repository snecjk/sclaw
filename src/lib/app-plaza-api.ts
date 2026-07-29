import { hostApiFetch } from '@/lib/host-api';
import type {
  AppItem,
  AppPlazaAppPage,
  AppPlazaBanner,
  AppPlazaBannerTargetType,
  AppPlazaCategory,
  AppTone,
} from '@/types/more-apps';

interface ApiEnvelope<T> {
  success: boolean;
  errCode?: string;
  errMessage?: string;
  data: T;
  total?: number | null;
}

interface RawAppPage {
  items?: unknown[];
  total?: number;
  pageNum?: number;
  pageSize?: number;
}

const APP_TONES = new Set<AppTone>(['blue', 'orange', 'green', 'purple', 'teal', 'gray']);
const BANNER_TARGET_TYPES = new Set<AppPlazaBannerTargetType>(['APP', 'URL', 'NONE']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function safeWebUrl(value: unknown): string {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : '';
  } catch {
    return '';
  }
}

export function formatAppPlazaRecent(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function adaptAppPlazaApp(value: unknown): AppItem | null {
  const raw = record(value);
  const id = text(raw.id);
  const name = text(raw.name);
  const url = text(raw.url);
  if (!id || !name) return null;
  const tone = text(raw.tone) as AppTone;
  const systemCode = text(raw.systemCode) || undefined;
  return {
    id,
    name,
    description: text(raw.description),
    url,
    systemCode,
    iconKey: text(raw.iconKey),
    iconUrl: safeWebUrl(raw.iconUrl),
    tone: APP_TONES.has(tone) ? tone : 'gray',
    category: text(raw.category),
    categoryCode: text(raw.categoryCode),
    kind: 'builtin',
    official: raw.official === true,
    recommended: raw.recommended === true,
    badge: text(raw.badge) || undefined,
    order: number(raw.order),
    hidden: raw.hidden === true,
    recent: formatAppPlazaRecent(raw.recent),
  };
}

/** Append returnUrl onto a skip-login ticket URL (portal product-map behavior). */
export function appendSkipLoginReturnUrl(skipLoginUrl: string, returnUrl: string): string {
  const ticket = text(skipLoginUrl);
  const target = safeWebUrl(returnUrl);
  if (!ticket || !target) return ticket;
  try {
    const parsed = new URL(ticket);
    parsed.searchParams.set('returnUrl', target);
    return parsed.toString();
  } catch {
    const sep = ticket.includes('?') ? '&' : '?';
    return `${ticket}${sep}returnUrl=${encodeURIComponent(target)}`;
  }
}

export function adaptAppPlazaCategory(value: unknown): AppPlazaCategory | null {
  const raw = record(value);
  const id = text(raw.id);
  const name = text(raw.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: text(raw.description),
    iconKey: text(raw.iconKey),
    iconUrl: safeWebUrl(raw.iconUrl),
    order: number(raw.order),
  };
}

export function adaptAppPlazaBanner(value: unknown): AppPlazaBanner | null {
  const raw = record(value);
  const id = text(raw.id);
  if (!id) return null;
  const targetTypeValue = text(raw.targetType) as AppPlazaBannerTargetType;
  const targetType = BANNER_TARGET_TYPES.has(targetTypeValue) ? targetTypeValue : 'NONE';
  return {
    id,
    title: text(raw.title),
    subtitle: text(raw.subtitle),
    imageUrl: safeWebUrl(raw.imageUrl),
    targetType,
    targetAppId: targetType === 'APP' ? text(raw.targetAppId) || null : null,
    targetUrl: targetType === 'URL' ? safeWebUrl(raw.targetUrl) : '',
    order: number(raw.order),
  };
}

function unwrap<T>(response: ApiEnvelope<T>, fallback: string): T {
  if (!response.success || response.data == null) {
    throw new Error(response.errMessage || fallback);
  }
  return response.data;
}

export interface FetchAppPlazaAppsParams {
  pageNum: number;
  pageSize: number;
  keyword?: string;
  categoryCode?: string;
}

export async function fetchAppPlazaApps(params: FetchAppPlazaAppsParams): Promise<AppPlazaAppPage> {
  const query = new URLSearchParams({
    pageNum: String(params.pageNum),
    pageSize: String(params.pageSize),
  });
  if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
  if (params.categoryCode?.trim()) query.set('categoryCode', params.categoryCode.trim());
  const response = await hostApiFetch<ApiEnvelope<RawAppPage>>(`/api/app-plaza/apps?${query.toString()}`);
  const data = unwrap(response, '应用列表加载失败');
  return {
    items: (data.items ?? []).map(adaptAppPlazaApp).filter((item): item is AppItem => item !== null),
    total: number(data.total, number(response.total)),
    pageNum: number(data.pageNum, params.pageNum),
    pageSize: number(data.pageSize, params.pageSize),
  };
}

export async function fetchAppPlazaCategories(): Promise<AppPlazaCategory[]> {
  const response = await hostApiFetch<ApiEnvelope<unknown[]>>('/api/app-plaza/categories');
  return unwrap(response, '应用分类加载失败')
    .map(adaptAppPlazaCategory)
    .filter((item): item is AppPlazaCategory => item !== null)
    .sort((a, b) => a.order - b.order);
}

export async function fetchAppPlazaBanners(): Promise<AppPlazaBanner[]> {
  const response = await hostApiFetch<ApiEnvelope<unknown[]>>('/api/app-plaza/banners');
  return unwrap(response, 'Banner 加载失败')
    .map(adaptAppPlazaBanner)
    .filter((item): item is AppPlazaBanner => item !== null)
    .sort((a, b) => a.order - b.order);
}

/** Fetch skip-login URL for a subsystem code via Host → memory-center. */
export async function fetchAppPlazaSkipLoginLink(systemCode: string): Promise<string> {
  const code = systemCode.trim();
  if (!code) {
    throw new Error('systemCode 不能为空');
  }
  const query = new URLSearchParams({ systemCode: code });
  const response = await hostApiFetch<ApiEnvelope<string>>(
    `/api/app-plaza/skip-login-link?${query.toString()}`,
  );
  const link = unwrap(response, '免登链接获取失败');
  const url = text(link);
  if (!url) {
    throw new Error('免登链接为空');
  }
  return url;
}
