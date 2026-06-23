/**
 * 网点 memory-center 代理：Key 确保 + 额度扩容
 *
 * 注意：模型推理域名（getSupplierDomain）仍在客户端本地配置，
 * 不经 memory-center 下发或管理。
 */

import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';

const SITE_KEY_ENSURE_PATH = '/agent/v1/site-keys/ensure';
const TOKEN_QUOTA_EXPANSION_PATH = '/agent/v1/token-quota/expansion';

export class StoSiteMemoryApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StoSiteMemoryApiError';
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
    throw new StoSiteMemoryApiError('未登录或 stoToken 已过期，请重新登录', 401);
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
    throw new StoSiteMemoryApiError(
      parseErrorMessage(json, text || `请求失败 (${response.status})`),
      response.status,
    );
  }

  if (
    typeof json === 'object' &&
    json !== null &&
    (json as { success?: boolean }).success === false
  ) {
    throw new StoSiteMemoryApiError(parseErrorMessage(json, '请求失败'), 400);
  }

  return json;
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

  const json = await memoryCenterFetch(SITE_KEY_ENSURE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force_refresh: forceRefresh }),
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

  await memoryCenterFetch(TOKEN_QUOTA_EXPANSION_PATH, {
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
  });
}
