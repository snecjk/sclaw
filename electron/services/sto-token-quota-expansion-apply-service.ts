/**
 * 非网点额度扩容：代理 memory-center /agent/v1/token-quota/expansion
 */

import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import {
  buildHqExpansionApplyPayload,
  type HqExpansionRequestBody,
} from './token-quota-expansion-validation';

const EXPANSION_APPLY_PATH = '/agent/v1/token-quota/expansion';

export class StoTokenQuotaExpansionApplyError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StoTokenQuotaExpansionApplyError';
    this.statusCode = statusCode;
  }
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

function parseErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (typeof record.errMessage === 'string' && record.errMessage.trim()) {
      return record.errMessage.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
    if (typeof record.detail === 'string' && record.detail.trim()) {
      return record.detail.trim();
    }
  }
  return fallback;
}

export async function applyHqTokenQuotaExpansion(body: HqExpansionRequestBody): Promise<void> {
  const token = await getStoToken();
  if (!token) {
    throw new StoTokenQuotaExpansionApplyError('未登录或 stoToken 已过期，请重新登录', 401);
  }

  const baseUrl = await resolveStoBaseUrl();
  const url = `${baseUrl}${EXPANSION_APPLY_PATH}`;
  const ssoEnv = await getSsoEnvironment();
  const payload = {
    ...buildHqExpansionApplyPayload(body),
    client: {
      app: 'sto-claw',
      version: resolveClientVersion(),
      platform: resolveClientPlatform(),
    },
  };

  logger.info(`[HqExpansionApply] POST ${url} token_id=${payload.token_id}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': 'application/json',
      'X-Sto-Sso-Env': ssoEnv,
    },
    body: JSON.stringify(payload),
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
    const message = parseErrorMessage(json, text || `额度申请失败 (${response.status})`);
    throw new StoTokenQuotaExpansionApplyError(message, response.status);
  }

  if (typeof json === 'object' && json !== null && (json as { success?: boolean }).success === false) {
    const message = parseErrorMessage(json, '额度申请失败');
    throw new StoTokenQuotaExpansionApplyError(message, 400);
  }
}
