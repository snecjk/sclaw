/**
 * 总部演示 — 网点账号切换（代理 memory-center /agent/v1/account-switch）
 */

import type { SsoUserInfo } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';

const FETCH_TIMEOUT_MS = 15_000;

export interface AccountSwitchOption {
  code: string;
  label: string;
}

interface MemoryCenterEnvelope<T> {
  success?: boolean;
  errCode?: string;
  errMessage?: string;
  data?: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function memoryCenterFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<MemoryCenterEnvelope<T>> {
  const baseUrl = await resolveStoBaseUrl();
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null)) as MemoryCenterEnvelope<T> | null;
  if (!payload || typeof payload !== 'object') {
    throw new Error('网点账号切换接口响应格式异常');
  }
  return payload;
}

export async function fetchAccountSwitchOptions(
  token: string,
): Promise<{ options: AccountSwitchOption[]; originUserCode: string | null }> {
  const payload = await memoryCenterFetch<{
    options?: AccountSwitchOption[];
    originUserCode?: string | null;
  }>('/agent/v1/account-switch/options', token, { method: 'GET' });

  if (!payload.success) {
    return { options: [], originUserCode: null };
  }

  const data = payload.data;
  const options = Array.isArray(data?.options)
    ? data.options
        .filter((item): item is AccountSwitchOption => isRecord(item) && typeof item.code === 'string')
        .map((item) => ({
          code: String(item.code).trim(),
          label: String(item.label || item.code).trim(),
        }))
        .filter((item) => item.code.length > 0)
    : [];

  return {
    options,
    originUserCode: typeof data?.originUserCode === 'string' ? data.originUserCode : null,
  };
}

export async function switchAccountViaMemoryCenter(
  token: string,
  targetCode: string,
): Promise<SsoUserInfo> {
  const body: Record<string, string> = { targetCode };

  const payload = await memoryCenterFetch<{ user?: SsoUserInfo }>(
    '/agent/v1/account-switch',
    token,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  if (!payload.success) {
    throw new Error(payload.errMessage || '切换网点账号失败');
  }

  const user = payload.data?.user;
  if (!user?.stoToken) {
    throw new Error('切换响应缺少用户信息');
  }

  return user;
}
