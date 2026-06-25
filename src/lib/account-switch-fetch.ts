import { hostApiFetch } from '@/lib/host-api';

export interface AccountSwitchOption {
  code: string;
  label: string;
}

type SsoEnvironment =
  | 'daily-external'
  | 'production-internal'
  | 'production-external'
  | 'pre-release'
  | 'local';

interface AccountSwitchUser {
  stoToken?: string;
}

function resolveBaseUrl(ssoEnvironment: SsoEnvironment): string {
  return MEMORY_CENTER_BASE[ssoEnvironment] || MEMORY_CENTER_BASE['production-external'];
}

function isMissingHostApiRoute(error: unknown, method: string, path: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`No route for ${method} ${path}`);
}

export function isAccountSwitchHostApiMissing(error: unknown, method: 'GET' | 'POST', path: string): boolean {
  return isMissingHostApiRoute(error, method, path);
}

export function isAuthSessionCommitHostApiMissing(error: unknown): boolean {
  return isMissingHostApiRoute(error, 'POST', '/api/auth/session/commit');
}

async function memoryCenterJson(
  user: AccountSwitchUser,
  ssoEnvironment: SsoEnvironment,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const token = user.stoToken?.trim();
  if (!token) {
    throw new Error('缺少 stoToken，请重新登录');
  }

  const response = await fetch(`${resolveBaseUrl(ssoEnvironment)}${path}`, {
    ...init,
    headers: {
      stotoken: token,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'errMessage' in payload
      ? String((payload as { errMessage?: string }).errMessage)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }

  const root = payload as { success?: boolean; errMessage?: string } | null;
  if (root && root.success === false) {
    throw new Error(root.errMessage || 'memory-center 返回失败');
  }

  return payload;
}

function unwrapEnvelopeData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const root = payload as Record<string, unknown>;
  if (root.data && typeof root.data === 'object') {
    return root.data as Record<string, unknown>;
  }
  return root;
}

const MEMORY_CENTER_BASE: Record<SsoEnvironment, string> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn',
  'pre-release': 'https://pre-baseinfo-aimemory.sto.cn',
  local: 'http://127.0.0.1:7001',
  'production-external': 'https://baseinfo-aimemory.sto.cn',
  'production-internal': 'https://baseinfo-aimemory.sto.cn',
};

function normalizeOptionsPayload(payload: unknown): {
  options: AccountSwitchOption[];
  originUserCode: string | null;
} {
  if (!payload || typeof payload !== 'object') {
    return { options: [], originUserCode: null };
  }

  const root = payload as Record<string, unknown>;
  const nested = root.data && typeof root.data === 'object'
    ? (root.data as Record<string, unknown>)
    : root;

  const options = Array.isArray(nested.options)
    ? nested.options
        .filter((item): item is AccountSwitchOption => {
          return !!item && typeof item === 'object' && typeof (item as AccountSwitchOption).code === 'string';
        })
        .map((item) => ({
          code: String(item.code).trim(),
          label: String(item.label || item.code).trim(),
        }))
        .filter((item) => item.code.length > 0)
    : [];

  return {
    options,
    originUserCode: typeof nested.originUserCode === 'string' ? nested.originUserCode : null,
  };
}

async function fetchAccountSwitchOptionsDirect(
  user: AccountSwitchUser,
  ssoEnvironment: SsoEnvironment,
): Promise<{ options: AccountSwitchOption[]; originUserCode: string | null }> {
  const payload = await memoryCenterJson(
    user,
    ssoEnvironment,
    '/agent/v1/account-switch/options',
    { method: 'GET' },
  );
  return normalizeOptionsPayload(payload);
}

export async function fetchAccountSwitchOptions(
  user: AccountSwitchUser | null,
  ssoEnvironment: SsoEnvironment,
): Promise<{ options: AccountSwitchOption[]; originUserCode: string | null }> {
  try {
    const data = await hostApiFetch<{
      success?: boolean;
      options?: AccountSwitchOption[];
      originUserCode?: string | null;
    }>('/api/auth/account-switch/options');
    return normalizeOptionsPayload(data);
  } catch (error) {
    if (!user || !isAccountSwitchHostApiMissing(error, 'GET', '/api/auth/account-switch/options')) {
      throw error;
    }
    return fetchAccountSwitchOptionsDirect(user, ssoEnvironment);
  }
}

export async function postAccountSwitchDirect(
  user: AccountSwitchUser,
  ssoEnvironment: SsoEnvironment,
  targetCode: string,
): Promise<Record<string, unknown>> {
  const payload = await memoryCenterJson(
    user,
    ssoEnvironment,
    '/agent/v1/account-switch',
    {
      method: 'POST',
      body: JSON.stringify({ targetCode }),
    },
  );
  const data = unwrapEnvelopeData(payload);
  const switchedUser = data.user;
  if (!switchedUser || typeof switchedUser !== 'object') {
    throw new Error('切换响应缺少用户信息');
  }
  return switchedUser as Record<string, unknown>;
}
