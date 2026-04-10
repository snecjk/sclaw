/**
 * STO Token Quota Service
 *
 * Proxies the token quota check endpoint from the STO AI Memory Center backend
 * using the stored stoToken and the shared auth header helper.
 */

import { getSsoEnvironment, getStoToken, type SsoEnvironment } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { logger } from '../utils/logger';

const STO_TOKEN_QUOTA_DOMAINS: Partial<Record<SsoEnvironment, string>> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn',
  'pre-release': 'https://pre-baseinfo-aimemory.sto.cn',
  'local': 'http://127.0.0.1:7001',
};

const STO_TOKEN_QUOTA_DOMAIN_DEFAULT = 'https://baseinfo-aimemory.sto.cn';
const STO_TOKEN_QUOTA_PATH = '/agent/v1/token-quota/check';

export interface StoTokenQuotaData {
  remaining?: number;
  limit?: number;
  used?: number;
  quota?: number;
  resetAt?: string;
  [key: string]: unknown;
}

export interface StoTokenQuotaCheckResponse {
  success: boolean;
  data: StoTokenQuotaData;
}

export class StoTokenQuotaServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StoTokenQuotaServiceError';
    this.statusCode = statusCode;
  }
}

function resolveStoTokenQuotaBaseUrl(env: SsoEnvironment): string {
  return STO_TOKEN_QUOTA_DOMAINS[env] || STO_TOKEN_QUOTA_DOMAIN_DEFAULT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStoTokenQuotaResponse(payload: unknown): StoTokenQuotaCheckResponse {
  if (!isRecord(payload)) {
    throw new StoTokenQuotaServiceError(
      'STO token quota response payload is malformed',
      502,
    );
  }

  if (typeof payload.success !== 'boolean' || !isRecord(payload.data)) {
    throw new StoTokenQuotaServiceError(
      'STO token quota response payload is malformed',
      502,
    );
  }

  return {
    success: payload.success,
    data: payload.data as StoTokenQuotaData,
  };
}

export class StoTokenQuotaService {
  static resolveDomain(env: SsoEnvironment): string {
    return resolveStoTokenQuotaBaseUrl(env);
  }

  async checkTokenQuota(): Promise<StoTokenQuotaCheckResponse> {
    const token = await getStoToken();
    if (!token) {
      throw new StoTokenQuotaServiceError(
        '未登录或 stoToken 已过期，请重新登录',
        401,
      );
    }

    const env = await getSsoEnvironment();
    const baseUrl = StoTokenQuotaService.resolveDomain(env);
    const url = `${baseUrl}${STO_TOKEN_QUOTA_PATH}`;
    logger.info(`[StoTokenQuotaService] checkTokenQuota: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildStoMemoryCenterAuthHeaders(token),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new StoTokenQuotaServiceError(
        `STO token quota check failed (${response.status}): ${text}`,
        response.status === 403 ? 403 : 401,
      );
    }

    const payload = await response.json() as unknown;
    return parseStoTokenQuotaResponse(payload);
  }
}

let instance: StoTokenQuotaService | null = null;

export function getStoTokenQuotaService(): StoTokenQuotaService {
  if (!instance) {
    instance = new StoTokenQuotaService();
  }
  return instance;
}
