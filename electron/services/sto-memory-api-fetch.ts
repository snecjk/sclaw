/**
 * Shared memory-center fetch helpers with session vs AI token selection.
 */

import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { getAiResourceStoToken } from './sto-auth-mode';

export class StoMemoryApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StoMemoryApiError';
    this.statusCode = statusCode;
  }
}

export function parseMemoryCenterErrorMessage(payload: unknown, fallback: string): string {
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

async function memoryCenterFetchWithToken(
  path: string,
  init: RequestInit,
  token: string | null,
  errorClass: typeof StoMemoryApiError = StoMemoryApiError,
): Promise<unknown> {
  if (!token) {
    throw new errorClass('未登录或 stoToken 已过期，请重新登录', 401);
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
    throw new errorClass(
      parseMemoryCenterErrorMessage(json, text || `请求失败 (${response.status})`),
      response.status,
    );
  }

  if (
    typeof json === 'object' &&
    json !== null &&
    (json as { success?: boolean }).success === false
  ) {
    throw new errorClass(parseMemoryCenterErrorMessage(json, '请求失败'), 400);
  }

  return json;
}

/** Session/business memory-center calls (account-switch, site expansion audit, etc.). */
export async function memoryCenterFetchForSession(
  path: string,
  init: RequestInit,
  errorClass: typeof StoMemoryApiError = StoMemoryApiError,
): Promise<unknown> {
  const token = await getStoToken();
  return memoryCenterFetchWithToken(path, init, token, errorClass);
}

/** AI resource memory-center calls (SK ensure, models, HQ quota tiers). */
export async function memoryCenterFetchForAi(
  path: string,
  init: RequestInit,
  errorClass: typeof StoMemoryApiError = StoMemoryApiError,
): Promise<unknown> {
  const token = await getAiResourceStoToken();
  return memoryCenterFetchWithToken(path, init, token, errorClass);
}
