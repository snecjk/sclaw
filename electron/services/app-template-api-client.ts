import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';

export type AppTemplatePageType = 'site' | 'assets';
export type AppTemplateSource = 'local-resource' | 'memory-center';

export interface AppTemplateSummary {
  templateId: string;
  pageType: AppTemplatePageType;
  name: string;
  description: string;
  status: 'ACTIVE' | 'DISABLED';
  isBuiltin: boolean;
  latestVersion: string;
  createdAt: string;
  updatedAt: string;
  source?: AppTemplateSource;
}

export interface AppTemplatePageResult {
  items: AppTemplateSummary[];
  total: number;
  pageNum: number;
  pageSize: number;
}

export interface AppTemplateVersion {
  templateId: string;
  version: string;
  status: 'ACTIVE';
  packageOssKey: string;
  packageEtag: string | null;
  packageSize: number;
  publishedAt: string;
}

export interface AppTemplateDownloadInfo {
  templateId: string;
  version: string;
  packageOssKey: string;
  packageEtag: string | null;
  packageSize: number;
  downloadUrl: string;
  expiresAt: string;
}

export interface AppTemplatePublishMetadata {
  templateId: string;
  pageType: AppTemplatePageType;
  name: string;
  description?: string;
}

export interface AppTemplatePublishResult {
  templateId: string;
  pageType: AppTemplatePageType;
  version: string;
  status: 'ACTIVE';
  isBuiltin: boolean;
  packageOssKey: string;
  packageEtag: string | null;
  packageSize: number;
  created: boolean;
}

interface ApiEnvelope<T> {
  success?: boolean;
  errCode?: string;
  errMessage?: string;
  traceId?: string;
  data?: T;
}

interface AppTemplateApiClientDeps {
  resolveBaseUrl?: () => Promise<string>;
  getAuthHeaders?: () => Promise<Record<string, string>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function defaultAuthHeaders(): Promise<Record<string, string>> {
  const token = await getStoToken();
  if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');
  return buildStoMemoryCenterAuthHeaders(token);
}

export class AppTemplateApiError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'AppTemplateApiError';
  }
}

function apiError(payload: ApiEnvelope<unknown> | undefined, status: number): Error {
  const message = payload?.errMessage?.trim() || `应用模板接口请求失败 (${status})`;
  const details = [payload?.errCode, payload?.traceId ? `traceId: ${payload.traceId}` : '']
    .filter(Boolean)
    .join(', ');
  return new AppTemplateApiError(details ? `${message} (${details})` : message, status);
}

export class AppTemplateApiClient {
  private readonly resolveBaseUrl: () => Promise<string>;
  private readonly getAuthHeaders: () => Promise<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(deps: AppTemplateApiClientDeps = {}) {
    this.resolveBaseUrl = deps.resolveBaseUrl ?? resolveStoBaseUrl;
    this.getAuthHeaders = deps.getAuthHeaders ?? defaultAuthHeaders;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? 30_000;
  }

  private async request<T>(endpoint: string, init: RequestInit): Promise<T> {
    const [baseUrl, authHeaders] = await Promise.all([
      this.resolveBaseUrl(),
      this.getAuthHeaders(),
    ]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}${endpoint}`, {
        ...init,
        headers: { ...authHeaders, ...init.headers },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`应用模板接口请求超时 (${this.timeoutMs}ms)`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    let payload: ApiEnvelope<T> | undefined;
    try {
      payload = await response.json() as ApiEnvelope<T>;
    } catch {
      payload = undefined;
    }
    if (!response.ok || payload?.success === false) {
      throw apiError(payload, response.status);
    }
    if (!payload || payload.data === undefined) {
      throw new Error('应用模板接口返回缺少 data');
    }
    return payload.data;
  }

  page(input: {
    pageType?: AppTemplatePageType;
    status?: 'ACTIVE' | 'DISABLED';
    keyword?: string;
    pageNum?: number;
    pageSize?: number;
  }): Promise<AppTemplatePageResult> {
    return this.request('/agent/v1/app-templates/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNum: 1, pageSize: 20, status: 'ACTIVE', ...input }),
    });
  }

  publish(input: {
    metadata: AppTemplatePublishMetadata;
    packageBytes: Uint8Array;
  }): Promise<AppTemplatePublishResult> {
    const form = new FormData();
    form.append('metadata', JSON.stringify(input.metadata));
    form.append(
      'file',
      new Blob([Uint8Array.from(input.packageBytes)], { type: 'application/zip' }),
      'template.zip',
    );
    return this.request('/agent/v1/app-templates/publish', {
      method: 'POST',
      body: form,
    });
  }

  delete(templateId: string): Promise<{ templateId: string; status: 'DISABLED' }> {
    return this.request(`/agent/v1/app-templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
    });
  }

  listVersions(templateId: string): Promise<AppTemplateVersion[]> {
    return this.request(
      `/agent/v1/app-templates/${encodeURIComponent(templateId)}/versions`,
      { method: 'GET' },
    );
  }

  getDownloadInfo(templateId: string, version: string): Promise<AppTemplateDownloadInfo> {
    return this.request(
      `/agent/v1/app-templates/${encodeURIComponent(templateId)}/versions/` +
        `${encodeURIComponent(version)}/download`,
      { method: 'GET' },
    );
  }
}

export const appTemplateApiClient = new AppTemplateApiClient();
