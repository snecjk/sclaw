import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { StoSsoAuthError } from '../errors';

interface LocalViteEnvironment {
  secret: string;
  workspaceId: string;
  applicationId: string;
  pageType: 'site' | 'assets';
  deployEnv: 'daily';
  hostApi: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new StoSsoAuthError('LOCAL_AUTH_UNAVAILABLE', `缺少服务端环境变量 ${name}`);
  }
  return value;
}

function readEnvironment(): LocalViteEnvironment {
  const pageType = required('STO_SSO_AUTH_PAGE_TYPE');
  if (pageType !== 'site' && pageType !== 'assets') {
    throw new StoSsoAuthError(
      'SSO_AUTH_PAGE_TYPE_UNSUPPORTED',
      'SSO Auth Vite 插件不支持当前应用类型',
    );
  }
  const deployEnv = required('STO_SSO_AUTH_DEPLOY_ENV');
  if (deployEnv !== 'daily') {
    throw new StoSsoAuthError('LOCAL_AUTH_UNAVAILABLE', '本地预览环境必须是 daily');
  }
  const hostApi = required('STO_SSO_AUTH_HOST_API').replace(/\/+$/, '');
  const parsedHostApi = new URL(hostApi);
  if (
    parsedHostApi.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(parsedHostApi.hostname)
  ) {
    throw new StoSsoAuthError('LOCAL_AUTH_UNAVAILABLE', 'Host API 必须是本机 HTTP 地址');
  }
  return {
    secret: required('STO_SSO_AUTH_SESSION'),
    workspaceId: required('STO_SSO_AUTH_WORKSPACE_ID'),
    applicationId: required('STO_SSO_AUTH_APPLICATION_ID'),
    pageType,
    deployEnv: 'daily',
    hostApi,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeUser(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const user: Record<string, string> = {};
  for (const key of ['userId', 'userCode', 'userName', 'mobile', 'avatar']) {
    if (typeof source[key] === 'string' && source[key].trim()) user[key] = source[key].trim();
  }
  return user;
}

async function forwardIdentity(
  env: LocalViteEnvironment,
  res: ServerResponse,
): Promise<void> {
  try {
    const response = await globalThis.fetch(
      `${env.hostApi}/api/app-dev/sso-auth/bootstrap`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-sto-sso-auth-workspace': env.workspaceId,
          'x-sto-sso-auth-session': env.secret,
        },
      },
    );
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      raw = null;
    }
    const record = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    if (!response.ok) {
      const error = response.status === 401
        ? 'AUTH_REQUIRED'
        : response.status === 403
          ? 'LOCAL_AUTH_SESSION_DENIED'
          : 'LOCAL_AUTH_UNAVAILABLE';
      sendJson(res, response.status, { success: false, error });
      return;
    }
    const token = typeof record.token === 'string' ? record.token.trim() : '';
    const user = safeUser(record.user);
    if (!token || !user) {
      sendJson(res, 502, { success: false, error: 'LOCAL_AUTH_UNAVAILABLE' });
      return;
    }
    sendJson(res, 200, { success: true, token, user });
  } catch {
    sendJson(res, 502, { success: false, error: 'LOCAL_AUTH_UNAVAILABLE' });
  }
}

export function ssoAuthVite(): Plugin {
  let env: LocalViteEnvironment | undefined;

  return {
    name: 'sto-sso-auth',
    apply: 'serve',
    enforce: 'pre',
    configResolved() {
      env = readEnvironment();
    },
    transformIndexHtml() {
      if (!env) env = readEnvironment();
      const publicConfig = {
        protocolVersion: 'sto-sso-auth/v1',
        applicationId: env.applicationId,
        pageType: env.pageType,
        runtimeMode: 'local',
        deployEnv: env.deployEnv,
      };
      return [{
        tag: 'script',
        children: `window.__STO_SSO_AUTH_CONFIG__=${JSON.stringify(publicConfig)};`,
        injectTo: 'head-prepend',
      }];
    },
    configureServer(server) {
      if (!env) env = readEnvironment();
      const serverEnvironment = env;
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = req.url ? new URL(req.url, 'http://127.0.0.1').pathname : '';
        if (path !== '/__sto/sso-auth/bootstrap' || req.method !== 'GET') {
          next();
          return;
        }
        void forwardIdentity(serverEnvironment, res);
      });
    },
  };
}
