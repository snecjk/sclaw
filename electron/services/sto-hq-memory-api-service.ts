/**
 * 非网点 memory-center 代理：Key 确保 + 套餐档位查询
 */

import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';

const HQ_KEY_ENSURE_PATH = '/agent/v1/hq-keys/ensure';
const TOKEN_QUOTA_TIERS_PATH = '/agent/v1/token-quota/tiers';

export class StoHqMemoryApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StoHqMemoryApiError';
    this.statusCode = statusCode;
  }
}

function parseErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (typeof record.errMessage === 'string' && record.errMessage.trim()) {
      return record.errMessage.trim();
    }
    if (typeof record.detail === 'string' && record.detail.trim()) {
      return record.detail.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
  }
  return fallback;
}

async function memoryCenterFetch(
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const token = await getStoToken();
  if (!token) {
    throw new StoHqMemoryApiError('未登录或 stoToken 已过期，请重新登录', 401);
  }

  const baseUrl = await resolveStoBaseUrl();
  const url = `${baseUrl}${path}`;
  const ssoEnv = await getSsoEnvironment();

  const response = await fetch(url, {
    ...init,
    headers: {
      ...buildStoMemoryCenterAuthHeaders(token),
      'X-Sto-Sso-Env': ssoEnv,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  const text = await response.text().catch(() => '');
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    throw new StoHqMemoryApiError(
      parseErrorMessage(json, text || `请求失败 (${response.status})`),
      response.status,
    );
  }

  if (
    typeof json === 'object' &&
    json !== null &&
    (json as { success?: boolean }).success === false
  ) {
    throw new StoHqMemoryApiError(parseErrorMessage(json, '请求失败'), 400);
  }

  return json;
}

export interface HqKeyEnsureResult {
  created: boolean;
  encryptedKey: string;
  tokenId: string;
  models: string[];
  status: string;
  spend: number;
  maxBudget: number;
}

export async function ensureHqKeyViaMemoryCenter(): Promise<HqKeyEnsureResult | null> {
  logger.info('[HqMemory] ensure hq key via memory-center');

  const json = await memoryCenterFetch(HQ_KEY_ENSURE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force_refresh: false }),
  });

  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const data = (json as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const encryptedKey = String(data.encrypted_key ?? '').trim();
  const tokenId = String(data.token_id ?? '').trim();
  if (!encryptedKey || !tokenId) {
    return null;
  }

  const modelsRaw = data.models;
  const models = Array.isArray(modelsRaw) ? modelsRaw.map((m) => String(m)) : [];

  return {
    created: Boolean(data.created),
    encryptedKey,
    tokenId,
    models,
    status: String(data.status ?? ''),
    spend: Number(data.spend) || 0,
    maxBudget: Number(data.max_budget) || 0,
  };
}

export async function fetchHqTokenQuotaTiersViaMemoryCenter(
  tokenId: string,
): Promise<TokenQuotaTierQueryResult | null> {
  const trimmed = tokenId?.trim() || '';
  const query = trimmed ? `?token_id=${encodeURIComponent(trimmed)}` : '';
  logger.info(`[HqMemory] fetch token quota tiers tokenId=${trimmed || '(auto)'}`);

  const json = await memoryCenterFetch(`${TOKEN_QUOTA_TIERS_PATH}${query}`, {
    method: 'GET',
  });

  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const data = (json as { data?: TokenQuotaTierQueryResult | null }).data;
  if (!data || typeof data !== 'object') {
    return null;
  }
  if (!Array.isArray(data.tierList)) {
    return null;
  }
  return data as TokenQuotaTierQueryResult;
}
