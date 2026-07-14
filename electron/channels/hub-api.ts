import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { getStoToken } from '../utils/auth-store';
import { logger } from '../utils/logger';
import { resolveSclawHubBaseUrl } from './hub-config';
import { getLocalDeviceId } from './binding-service';

interface HubApiEnvelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
  msg?: string;
  errorMsg?: string;
  errMessage?: string;
  /** SSO 拦截常见字段 */
  statusMessage?: string;
  errCode?: string;
  statusCode?: string;
}

/**
 * 与 Apifox 调通方式对齐：智慧星 SSOAuthorize 认请求头 `stotoken`。
 * 不带 Authorization。用 Node https（不用 Electron session.fetch，避免被带 Cookie/改头导致 SSO 401）。
 */
function buildHubAuthHeaders(stoToken: string): Record<string, string> {
  return {
    stotoken: stoToken,
    'Content-Type': 'application/json',
  };
}

function resolveHubErrorMessage(json: HubApiEnvelope<unknown>, fallback: string): string {
  return json.errMessage
    || json.statusMessage
    || json.message
    || json.msg
    || json.errorMsg
    || (json.errCode ? `errCode=${json.errCode}` : '')
    || (json.statusCode ? `statusCode=${json.statusCode}` : '')
    || fallback;
}

function nodeHttpRequest(
  method: string,
  urlStr: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; text: string }> {
  const url = new URL(urlStr);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...headers,
          ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function hubFetch<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = resolveSclawHubBaseUrl();
  if (!base) {
    throw new Error('STO_SCLAW_HUB_BASE_URL (or STO_WISDOM_STAR_BASE_URL) is not configured');
  }
  const token = await getStoToken();
  if (!token) {
    throw new Error('未登录或 stoToken 已过期，请重新登录');
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = buildHubAuthHeaders(token);
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  logger.info(
    `[SclawHub] >>> ${method} ${url} hasStotoken=${Boolean(headers.stotoken)} tokenLen=${token.length} via=node-http headerKeys=${Object.keys(headers).join(',')}`,
  );

  const res = await nodeHttpRequest(method, url, headers, bodyText);
  const text = res.text;
  let json: HubApiEnvelope<T>;
  try {
    json = JSON.parse(text) as HubApiEnvelope<T>;
  } catch {
    logger.warn(`[SclawHub] <<< ${method} ${url} status=${res.status} non-json=${text.slice(0, 300)}`);
    throw new Error(`Hub API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  logger.info(
    `[SclawHub] <<< ${method} ${url} status=${res.status} success=${json.success} err=${resolveHubErrorMessage(json, '')} body=${text.slice(0, 240)}`,
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(resolveHubErrorMessage(json, `HTTP ${res.status}`));
  }
  if (json.success === false) {
    throw new Error(resolveHubErrorMessage(json, 'Hub API failed'));
  }
  return (json.data ?? json) as T;
}

export async function hubCreateBind(): Promise<{
  bindToken: string;
  expireSeconds: number;
  qrContent: string;
  deviceId: string;
}> {
  const deviceId = await getLocalDeviceId();
  const data = await hubFetch<{
    bindToken: string;
    expireSeconds: number;
    qrContent: string;
  }>('POST', '/api/sclaw/desktop/bind/create', { deviceId });
  return {
    ...data,
    qrContent: absolutizeHubUrl(data.qrContent),
    deviceId,
  };
}

/** Hub 未配 public-origin 时会返回相对路径；钉钉扫码需要完整 https URL 才会打开 H5。 */
function absolutizeHubUrl(content: string): string {
  const raw = (content || '').trim();
  if (!raw || /^https?:\/\//i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return raw;
  }
  const base = resolveSclawHubBaseUrl();
  if (!base) return raw;
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

export async function hubPollBind(bindToken: string): Promise<{
  status: string;
  ticket?: string;
  dingUserId?: string;
}> {
  const q = encodeURIComponent(bindToken);
  return hubFetch('GET', `/api/sclaw/desktop/bind/poll?bindToken=${q}`);
}

export async function hubClaimBind(ticket: string, deviceId?: string): Promise<{
  refreshToken: string;
  dingUserId: string;
  deviceId: string;
  status: string;
}> {
  const localDeviceId = deviceId || await getLocalDeviceId();
  return hubFetch('POST', '/api/sclaw/desktop/bind/claim', {
    ticket,
    deviceId: localDeviceId,
  });
}

export async function hubUnbindRemote(): Promise<void> {
  await hubFetch('POST', '/api/sclaw/desktop/bind/unbind', {});
}

export async function hubBindStatus(): Promise<{
  bound: boolean;
  dingUserId?: string;
  deviceId?: string;
  boundAt?: string;
}> {
  return hubFetch('GET', '/api/sclaw/desktop/bind/status');
}

export async function hubReplyStream(input: {
  chatUid: string;
  content: string;
  finalize?: boolean;
}): Promise<void> {
  await hubFetch('POST', '/api/sclaw/desktop/reply/stream', input);
}

export async function hubHeartbeat(refreshToken: string): Promise<void> {
  const deviceId = await getLocalDeviceId();
  try {
    await hubFetch('POST', '/api/sclaw/desktop/device/heartbeat', {
      refreshToken,
      deviceId,
    });
  } catch (error) {
    logger.warn('[SclawHub] heartbeat failed', error);
  }
}
