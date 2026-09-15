import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';

const STATUS_PATH = '/agent/v1/site-opening-status/current?clientCode=StoClaw';
const REGISTER_PATH = '/sclaw/net/register';
const FETCH_TIMEOUT_MS = 15_000;

export type SiteOpeningStatus = 'NOT_REGISTERED' | 'REGISTERED' | 'ENABLED';

export interface SiteOpeningStatusResult {
  status: SiteOpeningStatus;
  statusName: string;
  sclawAccessAllowed: boolean;
  modelTenantEnabled: boolean;
  siteCode?: string;
  siteName?: string;
  applicationNo?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEnvelope(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    const message = isRecord(payload)
      ? String(payload.errMessage ?? payload.message ?? '开通登记服务调用失败')
      : '开通登记服务响应格式异常';
    throw new Error(message);
  }
  return payload.data;
}

export class SiteOpeningRegistrationService {
  async getStatus(stoToken: string): Promise<SiteOpeningStatusResult> {
    const baseUrl = await resolveStoBaseUrl();
    const response = await fetch(`${baseUrl}${STATUS_PATH}`, {
      method: 'GET',
      headers: buildStoMemoryCenterAuthHeaders(stoToken),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = parseEnvelope(await response.json().catch(() => null));
    const status = String(data.status ?? '') as SiteOpeningStatus;
    if (!['NOT_REGISTERED', 'REGISTERED', 'ENABLED'].includes(status)) {
      throw new Error('开通状态响应格式异常');
    }
    return {
      status,
      statusName: String(data.statusName ?? ''),
      sclawAccessAllowed: data.sclawAccessAllowed === true,
      modelTenantEnabled: data.modelTenantEnabled === true,
      siteCode: typeof data.siteCode === 'string' ? data.siteCode : undefined,
      siteName: typeof data.siteName === 'string' ? data.siteName : undefined,
      applicationNo: typeof data.applicationNo === 'string' ? data.applicationNo : null,
    };
  }

  async register(stoToken: string): Promise<SiteOpeningStatusResult> {
    const baseUrl = await resolveStoBaseUrl();
    const response = await fetch(`${baseUrl}${REGISTER_PATH}`, {
      method: 'POST',
      headers: {
        ...buildStoMemoryCenterAuthHeaders(stoToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clientCode: 'StoClaw' }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = parseEnvelope(await response.json().catch(() => null));
    return {
      status: String(data.status ?? 'REGISTERED') as SiteOpeningStatus,
      statusName: String(data.statusName ?? '已登记，等待处理'),
      sclawAccessAllowed: false,
      modelTenantEnabled: false,
      applicationNo: typeof data.applicationNo === 'string' ? data.applicationNo : null,
    };
  }
}

let instance: SiteOpeningRegistrationService | null = null;

export function getSiteOpeningRegistrationService(): SiteOpeningRegistrationService {
  if (!instance) instance = new SiteOpeningRegistrationService();
  return instance;
}
