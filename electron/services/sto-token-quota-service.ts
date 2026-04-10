/**
 * STO Token Quota Service
 *
 * Proxies the token quota check endpoint from the STO AI Memory Center backend
 * using the stored stoToken and the shared auth header helper.
 */

import { getSsoEnvironment, getStoToken, type SsoEnvironment } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { logger } from '../utils/logger';

const STO_TOKEN_QUOTA_DOMAINS: Record<string, string> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn',
  'pre-release': 'https://pre-baseinfo-aimemory.sto.cn',
  'local': 'http://127.0.0.1:7001',
};

const STO_TOKEN_QUOTA_DOMAIN_DEFAULT = 'https://baseinfo-aimemory.sto.cn';
const STO_TOKEN_QUOTA_PATH = '/agent/v1/token-quota/check';

function resolveStoTokenQuotaBaseUrl(env: SsoEnvironment): string {
  return STO_TOKEN_QUOTA_DOMAINS[env] || STO_TOKEN_QUOTA_DOMAIN_DEFAULT;
}

export class StoTokenQuotaService {
  static resolveDomain(env: SsoEnvironment): string {
    return resolveStoTokenQuotaBaseUrl(env);
  }

  async checkTokenQuota(): Promise<unknown> {
    const token = await getStoToken();
    if (!token) {
      throw new Error('未登录或 stoToken 已过期，请重新登录');
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
      throw new Error(`STO token quota check failed (${response.status}): ${text}`);
    }

    return response.json();
  }
}

let instance: StoTokenQuotaService | null = null;

export function getStoTokenQuotaService(): StoTokenQuotaService {
  if (!instance) {
    instance = new StoTokenQuotaService();
  }
  return instance;
}
