/**
 * 网点 memory-center 代理：Key 确保 + 额度扩容
 *
 * 注意：模型推理域名（getSupplierDomain）仍在客户端本地配置，
 * 不经 memory-center 下发或管理。
 */

import { logger } from '../utils/logger';
import {
  memoryCenterFetchForAi,
  memoryCenterFetchForSession,
  StoMemoryApiError,
} from './sto-memory-api-fetch';

const SITE_KEY_ENSURE_PATH = '/agent/v1/site-keys/ensure';
const TOKEN_QUOTA_EXPANSION_PATH = '/agent/v1/token-quota/expansion';

export class StoSiteMemoryApiError extends StoMemoryApiError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'StoSiteMemoryApiError';
  }
}

export interface SiteKeyEnsureResult {
  created: boolean;
  encryptedKey: string;
  tokenId: string;
  models: string[];
  status: string;
  spend: number;
  maxBudget: number;
  tenantCode: string;
}

export async function ensureSiteKeyViaMemoryCenter(
  forceRefresh = false,
): Promise<SiteKeyEnsureResult | null> {
  logger.info(`[SiteMemory] ensure site key via memory-center, forceRefresh=${forceRefresh}`);

  const json = await memoryCenterFetchForAi(
    SITE_KEY_ENSURE_PATH,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force_refresh: forceRefresh }),
    },
    StoSiteMemoryApiError,
  );

  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const data = (json as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const encryptedKey = String(data.encrypted_key ?? '').trim();
  const tokenId = String(data.token_id ?? '').trim();
  const tenantCode = String(data.tenant_code ?? '').trim();
  if (!encryptedKey || !tokenId || !tenantCode) {
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
    tenantCode,
  };
}

export interface SiteExpansionRequestBody {
  tokenId: string;
  quotaAmount: number;
  clientEventId?: string;
}

function resolveClientPlatform(): string {
  try {
    return process.platform;
  } catch {
    return 'unknown';
  }
}

function resolveClientVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../../package.json') as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function applySiteTokenQuotaExpansionViaMemoryCenter(
  body: SiteExpansionRequestBody,
): Promise<void> {
  logger.info(`[SiteMemory] apply site expansion tokenId=${body.tokenId}, amount=${body.quotaAmount}`);

  await memoryCenterFetchForSession(
    TOKEN_QUOTA_EXPANSION_PATH,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token_id: body.tokenId.trim(),
        quota_amount: body.quotaAmount,
        client_event_id: body.clientEventId?.trim() || undefined,
        client: {
          app: 'sto-claw',
          version: resolveClientVersion(),
          platform: resolveClientPlatform(),
        },
      }),
    },
    StoSiteMemoryApiError,
  );
}
