import {
  memoryCenterFetchForSession,
  StoMemoryApiError,
} from './sto-memory-api-fetch';

export interface AppPlazaEnvelope<T> {
  success: boolean;
  errCode?: string;
  errMessage?: string;
  data: T;
  extend?: unknown;
  total?: number | null;
}

export interface AppPlazaAppClientItem {
  id: string;
  name: string;
  description: string;
  url: string;
  /** Subsystem code for GetRedirectLogonUrl skip-login exchange */
  systemCode?: string | null;
  iconKey: string;
  iconUrl: string;
  category: string;
  categoryCode: string;
  tone?: string | null;
  kind?: string | null;
  official?: boolean;
  recommended?: boolean;
  badge?: string | null;
  order?: number;
  hidden?: boolean;
  recent?: string | null;
}

export interface AppPlazaAppClientPage {
  items: AppPlazaAppClientItem[];
  total: number;
  pageNum: number;
  pageSize: number;
}

export interface AppPlazaCategoryClientItem {
  id: string;
  name: string;
  description: string;
  iconKey: string;
  iconUrl: string;
  order: number;
}

export interface AppPlazaBannerClientItem {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  targetType: 'APP' | 'URL' | 'NONE';
  targetAppId: string | null;
  targetUrl: string;
  order: number;
}

export interface ListAppPlazaAppsParams {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  categoryCode?: string;
}

function assertEnvelope<T>(value: unknown, label: string): AppPlazaEnvelope<T> {
  if (!value || typeof value !== 'object') {
    throw new StoMemoryApiError(`${label}响应格式异常`, 502);
  }
  const envelope = value as AppPlazaEnvelope<T>;
  if (envelope.success !== true || envelope.data == null) {
    throw new StoMemoryApiError(envelope.errMessage || `${label}请求失败`, 502);
  }
  return envelope;
}

export class AppPlazaService {
  async listApps(params: ListAppPlazaAppsParams = {}): Promise<AppPlazaEnvelope<AppPlazaAppClientPage>> {
    const query = new URLSearchParams();
    query.set('pageNum', String(Math.max(1, params.pageNum ?? 1)));
    query.set('pageSize', String(Math.min(100, Math.max(1, params.pageSize ?? 20))));
    const keyword = params.keyword?.trim();
    const categoryCode = params.categoryCode?.trim();
    if (keyword) query.set('keyword', keyword);
    if (categoryCode) query.set('categoryCode', categoryCode);

    const value = await memoryCenterFetchForSession(
      `/agent/v1/app-plaza/apps?${query.toString()}`,
      { method: 'POST' },
    );
    return assertEnvelope<AppPlazaAppClientPage>(value, '应用广场应用列表');
  }

  async listCategories(): Promise<AppPlazaEnvelope<AppPlazaCategoryClientItem[]>> {
    const value = await memoryCenterFetchForSession('/agent/v1/app-plaza/categories', { method: 'POST' });
    return assertEnvelope<AppPlazaCategoryClientItem[]>(value, '应用广场分类');
  }

  async listBanners(): Promise<AppPlazaEnvelope<AppPlazaBannerClientItem[]>> {
    const value = await memoryCenterFetchForSession('/agent/v1/app-plaza/banners', { method: 'POST' });
    return assertEnvelope<AppPlazaBannerClientItem[]>(value, '应用广场 Banner');
  }

  /**
   * Exchange stoToken → skip-login URL for a target subsystem.
   * Proxies memory-center `POST /agent/v1/app-plaza/skip-login-link`.
   */
  async getSkipLoginLink(systemCode: string): Promise<AppPlazaEnvelope<string>> {
    const code = systemCode.trim();
    if (!code) {
      throw new StoMemoryApiError('systemCode 不能为空', 422);
    }
    const query = new URLSearchParams({ systemCode: code });
    const value = await memoryCenterFetchForSession(
      `/agent/v1/app-plaza/skip-login-link?${query.toString()}`,
      { method: 'POST' },
    );
    return assertEnvelope<string>(value, '应用广场免登链接');
  }
}

let instance: AppPlazaService | null = null;

export function getAppPlazaService(): AppPlazaService {
  if (!instance) instance = new AppPlazaService();
  return instance;
}
