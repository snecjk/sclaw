import { StoSsoAuthError } from './errors';
import type { StoSsoAuth, StoSsoUser } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeUser(value: Record<string, unknown>): StoSsoUser {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => (
      !['stotoken', 'token', 'secret', 'session'].includes(key.toLowerCase())
    )),
  );
}

export function createLocalSsoAuth(options: { fetch: typeof fetch }): StoSsoAuth {
  let token: string | null = null;
  let user: StoSsoUser | null = null;
  let bootstrapPromise: Promise<void> | null = null;

  async function loadIdentity(): Promise<void> {
    const response = await options.fetch('/__sto/sso-auth/bootstrap', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new StoSsoAuthError(
        'LOCAL_AUTH_UNAVAILABLE',
        '本地身份服务返回了无效数据',
        { httpStatus: response.status },
      );
    }

    if (response.status === 401) {
      throw new StoSsoAuthError('AUTH_REQUIRED', 'SClaw 当前用户未登录', {
        httpStatus: 401,
      });
    }
    if (response.status === 403) {
      throw new StoSsoAuthError('LOCAL_AUTH_SESSION_DENIED', '本地身份 Session 无效', {
        httpStatus: 403,
      });
    }
    if (!response.ok || !isRecord(raw)) {
      throw new StoSsoAuthError('LOCAL_AUTH_UNAVAILABLE', '无法读取 SClaw 当前身份', {
        httpStatus: response.status,
      });
    }
    const nextToken = typeof raw.token === 'string' ? raw.token.trim() : '';
    if (!nextToken || !isRecord(raw.user)) {
      throw new StoSsoAuthError('LOCAL_AUTH_UNAVAILABLE', '本地身份响应缺少必要字段', {
        httpStatus: response.status,
      });
    }
    token = nextToken;
    user = sanitizeUser(raw.user);
  }

  return {
    bootstrap() {
      if (!bootstrapPromise) {
        bootstrapPromise = loadIdentity().catch((error) => {
          bootstrapPromise = null;
          throw error;
        });
      }
      return bootstrapPromise;
    },
    getToken() {
      return token;
    },
    getUser() {
      return user;
    },
    async logout() {
      token = null;
      user = null;
    },
    async handleUnauthorized() {
      token = null;
      user = null;
      bootstrapPromise = null;
      throw new StoSsoAuthError('AUTH_REQUIRED', 'SClaw 当前身份已失效');
    },
  };
}
