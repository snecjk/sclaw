import type {
  ExternalServicePageResult,
  ExternalServiceVersionConfig,
  ExternalServiceVersionSummary,
} from '../../shared/external-service-contract';
import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';

interface ApiEnvelope<T> {
  success?: boolean;
  errCode?: string;
  errMessage?: string;
  traceId?: string;
  data?: T;
}

interface ExternalServiceApiClientDeps {
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

export class ExternalServiceApiError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'ExternalServiceApiError';
  }
}

function apiError(payload: ApiEnvelope<unknown> | undefined, status: number): Error {
  const message = payload?.errMessage?.trim() || `外部服务接口请求失败 (${status})`;
  const details = [payload?.errCode, payload?.traceId ? `traceId: ${payload.traceId}` : '']
    .filter(Boolean)
    .join(', ');
  return new ExternalServiceApiError(details ? `${message} (${details})` : message, status);
}

export class ExternalServiceApiClient {
  private readonly resolveBaseUrl: () => Promise<string>;
  private readonly getAuthHeaders: () => Promise<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(deps: ExternalServiceApiClientDeps = {}) {
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
        throw new Error(`外部服务接口请求超时 (${this.timeoutMs}ms)`, { cause: error });
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
    if (!response.ok || payload?.success === false) throw apiError(payload, response.status);
    if (!payload || payload.data === undefined) throw new Error('外部服务接口返回缺少 data');
    return payload.data;
  }

  page(input: {
    keyword?: string;
    pageNum?: number;
    pageSize?: number;
  } = {}): Promise<ExternalServicePageResult> {
    return this.request('/agent/v1/external-services/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNum: 1, pageSize: 20, ...input }),
    });
  }

  listVersions(serviceUid: string): Promise<ExternalServiceVersionSummary[]> {
    return this.request(
      `/agent/v1/external-services/uid/${encodeURIComponent(serviceUid)}/versions`,
      { method: 'GET' },
    );
  }

  getVersion(serviceUid: string, version: string): Promise<ExternalServiceVersionConfig> {
    return this.request(
      `/agent/v1/external-services/uid/${encodeURIComponent(serviceUid)}/versions/${encodeURIComponent(version)}`,
      { method: 'GET' },
    );
  }

  resolveInstall(
    serviceUid: string,
    version: string,
    appCode: string,
  ): Promise<ExternalServiceVersionConfig> {
    return this.request(
      `/agent/v1/external-services/uid/${encodeURIComponent(serviceUid)}/versions/${encodeURIComponent(version)}/resolve-install`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appCode, version }),
      },
    );
  }
}

export const externalServiceApiClient = new ExternalServiceApiClient();
