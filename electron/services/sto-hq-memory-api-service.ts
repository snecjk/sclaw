/**
 * 非网点 memory-center 代理：Key 确保（含详情/模型列表）+ 套餐档位查询
 */

import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import { logger } from '../utils/logger';
import {
  memoryCenterFetchForAi,
  parseMemoryCenterErrorMessage,
  StoMemoryApiError,
} from './sto-memory-api-fetch';

const HQ_KEY_ENSURE_PATH = '/agent/v1/hq-keys/ensure';
const TOKEN_QUOTA_TIERS_PATH = '/agent/v1/token-quota/tiers';

export class StoHqMemoryApiError extends StoMemoryApiError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'StoHqMemoryApiError';
  }
}

export interface HqKeyEnsureResult {
  created: boolean;
  apiKey: string;
  tokenId: string;
  models: string[];
  status: string;
  spend: number;
  maxBudget: number;
}

export async function ensureHqKeyViaMemoryCenter(): Promise<HqKeyEnsureResult | null> {
  logger.info('[HqMemory] ensure hq key via memory-center');

  const json = await memoryCenterFetchForAi(
    HQ_KEY_ENSURE_PATH,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force_refresh: false }),
    },
    StoHqMemoryApiError,
  );

  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const data = (json as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const apiKey = String(data.api_key ?? '').trim();
  const tokenId = String(data.token_id ?? '').trim();
  if (!apiKey || !tokenId) {
    return null;
  }

  const modelsRaw = data.models;
  const models = Array.isArray(modelsRaw) ? modelsRaw.map((m) => String(m)) : [];

  return {
    created: Boolean(data.created),
    apiKey,
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

  const json = await memoryCenterFetchForAi(
    `${TOKEN_QUOTA_TIERS_PATH}${query}`,
    { method: 'GET' },
    StoHqMemoryApiError,
  );

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

export { parseMemoryCenterErrorMessage as parseHqMemoryErrorMessage };
