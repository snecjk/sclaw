import type { SsoUserInfo } from '../utils/auth-store';
import { logger } from '../utils/logger';

export interface OpenIMCredentials {
  enabled: boolean;
  apiAddr: string;
  wsAddr: string;
  userID: string;
  token: string;
}

function readEnv(key: string): string {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) return fromProcess;
  const fromImportMeta = (import.meta.env as Record<string, string | undefined>)[key];
  return (fromImportMeta || '').trim();
}

function isOpenIMEnabled(): boolean {
  return readEnv('VITE_OPENIM_ENABLED') === 'true';
}

function getOpenIMApiAddr(): string {
  return readEnv('VITE_OPENIM_API_ADDR') || 'http://127.0.0.1:10002';
}

function getOpenIMWsAddr(): string {
  return readEnv('VITE_OPENIM_WS_ADDR') || 'ws://127.0.0.1:10001';
}

function getOpenIMSecret(): string {
  return readEnv('OPENIM_SECRET') || readEnv('VITE_OPENIM_SECRET') || 'openIM123';
}

function getDevCredentials(): { userID: string; token: string } | null {
  const userID = readEnv('VITE_OPENIM_USER_ID');
  const token = readEnv('VITE_OPENIM_TOKEN');
  if (!userID || !token) return null;
  return { userID, token };
}

function resolveOpenIMUserID(user: SsoUserInfo): string {
  const devUserID = readEnv('VITE_OPENIM_USER_ID');
  if (devUserID) return devUserID;
  const fromId = user.id.trim();
  if (fromId) return fromId;
  return user.empCode.trim() || user.code.trim();
}

async function postOpenIM<T>(apiAddr: string, path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    operationID: `sto-claw-${Date.now()}`,
  };
  if (token) {
    headers.token = token;
  }

  const response = await fetch(`${apiAddr}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const payload = await response.json() as {
    errCode?: number;
    errMsg?: string;
    data?: T;
  };

  if (payload.errCode !== 0) {
    throw new Error(payload.errMsg || `OpenIM API error: ${String(payload.errCode)}`);
  }

  return payload.data as T;
}

async function fetchUserTokenFromOpenIM(apiAddr: string, userID: string, platformID: number): Promise<string> {
  const secret = getOpenIMSecret();
  const adminToken = await postOpenIM<{ token: string }>(apiAddr, '/auth/get_admin_token', {
    secret,
    userID: 'imAdmin',
    platformID: 2,
  });

  const userToken = await postOpenIM<{ token: string }>(
    apiAddr,
    '/auth/get_user_token',
    { userID, platformID },
    adminToken.token,
  );

  return userToken.token;
}

export interface ResolveOpenIMCredentialsOptions {
  /** Reuse this token when it belongs to the same user — avoids rotating a live session. */
  preferToken?: string;
  preferUserID?: string;
}

export async function resolveOpenIMCredentials(
  user: SsoUserInfo,
  options: ResolveOpenIMCredentialsOptions = {},
): Promise<OpenIMCredentials | null> {
  if (!isOpenIMEnabled()) {
    return null;
  }

  const apiAddr = getOpenIMApiAddr();
  const wsAddr = getOpenIMWsAddr();
  const userID = resolveOpenIMUserID(user);
  if (!userID) {
    throw new Error('无法解析 OpenIM userID');
  }

  const platformID = process.platform === 'darwin' ? 4 : process.platform === 'win32' ? 3 : 7;

  if (
    options.preferToken
    && options.preferUserID
    && options.preferUserID === userID
  ) {
    logger.info(`[OpenIM] Reusing active SDK token for userID=${userID}`);
    return {
      enabled: true,
      apiAddr,
      wsAddr,
      userID,
      token: options.preferToken,
    };
  }

  // Issue a fresh token only when there is no live SDK session for this user.
  try {
    const token = await fetchUserTokenFromOpenIM(apiAddr, userID, platformID);
    logger.info(`[OpenIM] Issued fresh user token for userID=${userID}`);
    return {
      enabled: true,
      apiAddr,
      wsAddr,
      userID,
      token,
    };
  } catch (error) {
    logger.warn('[OpenIM] Fresh token fetch failed, trying env fallback:', error);
  }

  const devCredentials = getDevCredentials();
  if (devCredentials) {
    logger.info(`[OpenIM] Using env fallback credentials for userID=${devCredentials.userID}`);
    return {
      enabled: true,
      apiAddr,
      wsAddr,
      userID: devCredentials.userID,
      token: devCredentials.token,
    };
  }

  throw new Error('无法获取 OpenIM token（服务端换票失败且无 env 兜底）');
}
