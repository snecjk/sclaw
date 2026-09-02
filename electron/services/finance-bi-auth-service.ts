import { getAppPlazaService } from './app-plaza-service';
import {
  getFinanceBiApiBase,
  STO_FINANCE_BI_SYSTEM_CODE,
} from '../../shared/finance-bi-config';
import { logger } from '../utils/logger';

/**
 * 对齐 preview `src/utils/auth.ts` + `src/config/axios/service.ts`
 *
 * 登录页换票后写入：
 * - auth.token      ← stoToken
 * - auth.userInfo   ← userInfo
 * - stoBiUserInfo   ← 换票完整 data
 * - auth.time
 *
 * 后续每个业务请求只带：
 * - x-bi-token      ← auth.token（与 preview HEADERS.TOKEN 一致）
 * - sid             ← auth.sid（若有）
 * - Accept-Language ← zh-CN
 */
interface CachedBiAuth {
  /** 等同 preview localStorage `auth.token` */
  token: string;
  /** 等同 preview localStorage `auth.userInfo` */
  userInfo: Record<string, unknown>;
  /** 等同 preview localStorage `stoBiUserInfo` */
  stoBiUserInfo: Record<string, unknown>;
  /** 等同 preview localStorage `auth.sid`（换票响应里通常没有，可选） */
  sid?: string;
  savedAt: number;
  expiresAt: number;
  apiBase: string;
}

/** BI token 缓存（进程内，语义对齐 preview localStorage）；TTL 预留刷新余量 */
const TOKEN_TTL_MS = 50 * 60 * 1000;

/** preview HEADERS.TOKEN */
const HEADER_TOKEN = 'x-bi-token';
const HEADER_SID = 'sid';

let cachedAuth: CachedBiAuth | null = null;
let inflight: Promise<CachedBiAuth> | null = null;

/** 最近一次换票调试信息（供 Host API 回传给渲染进程 DevTools） */
export type FinanceBiExchangeDebug = {
  at: string;
  /** 换票接口完整 URL */
  exchangeApiFullUrl?: string | null;
  code: string | null;
  apiBase: string | null;
  skipLoginUrl: string | null;
  exchangeHttpStatus: number | null;
  exchangeOk: boolean | null;
  exchangeBody: unknown;
  tokenPrefix: string | null;
  tokenLength: number | null;
  sid: string | null;
  requestMethod?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  requestHeadersPreview?: Record<string, string>;
  error?: string;
};

let lastExchangeDebug: FinanceBiExchangeDebug | null = null;

export function getLastFinanceBiExchangeDebug(): FinanceBiExchangeDebug | null {
  return lastExchangeDebug;
}

/** 最近一次业务列表接口调试（入参 / 请求头 / 出参） */
export type FinanceBiListCallDebug = {
  at: string;
  url: string;
  method: string;
  /** 调用入参 body */
  requestBody: unknown;
  /** 入参请求头（完整，含 token） */
  requestHeaders: Record<string, string>;
  httpStatus: number | null;
  ok: boolean | null;
  /** 出参 */
  responseBody: unknown;
  error?: string;
};

let lastListCallDebug: FinanceBiListCallDebug | null = null;

export function getLastFinanceBiListCallDebug(): FinanceBiListCallDebug | null {
  return lastListCallDebug;
}

/**
 * 与 preview runtimeHostEnv 对齐：按 page 域名推断 BI API。
 * 嵌入「我的报表」当前走 page.sto.cn → 必须打 finance-bi.sto.cn 换票。
 */
export function resolveFinanceBiApiBaseFromPageUrl(pageUrl?: string | null): string {
  const raw = (pageUrl || '').trim().toLowerCase();
  if (raw.includes('page-test.sto.cn') || raw.includes('finance-bi-test.sto.cn')) {
    return 'https://finance-bi-test.sto.cn';
  }
  if (raw.includes('pre-page.sto.cn') || raw.includes('pre-finance-bi.sto.cn')) {
    return 'https://pre-finance-bi.sto.cn';
  }
  if (raw.includes('page.sto.cn') || raw.includes('finance-bi.sto.cn')) {
    return 'https://finance-bi.sto.cn';
  }
  return getFinanceBiApiBase();
}

function extractSkipLoginCode(skipLoginUrl: string): string | null {
  const ticket = skipLoginUrl.trim();
  if (!ticket) return null;
  try {
    const parsed = new URL(ticket);
    const fromSearch = parsed.searchParams.get('code') || parsed.searchParams.get('authorizationCode');
    if (fromSearch) return fromSearch;
    const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const q = rawHash.indexOf('?');
    if (q >= 0) {
      const hashParams = new URLSearchParams(rawHash.slice(q + 1));
      return hashParams.get('code') || hashParams.get('authorizationCode');
    }
  } catch {
    // ignore
  }
  return null;
}

function pickToken(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.StoToken,
    payload.stoToken,
    payload.biToken,
    payload.token,
    payload.Token,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function pickUserInfo(payload: Record<string, unknown>): Record<string, unknown> {
  const raw = payload.UserInfo || payload.userInfo;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function pickSid(payload: Record<string, unknown>): string | undefined {
  const userInfo = pickUserInfo(payload);
  const sid =
    payload.sid
    || payload.Sid
    || userInfo.sid
    || userInfo.Sid;
  return typeof sid === 'string' && sid.trim() ? sid.trim() : undefined;
}

function extractErrorMessage(json: Record<string, unknown>, fallback: string): string {
  return String(json.msg || json.message || json.error || json.statusMessage || fallback);
}

/**
 * 对齐 preview `saveAuthToLocalStorage` + `saveStoBiUserInfo`
 */
function saveAuthLikePreview(
  token: string,
  userInfo: Record<string, unknown>,
  stoBiUserInfo: Record<string, unknown>,
  apiBase: string,
  sid?: string,
): CachedBiAuth {
  const auth: CachedBiAuth = {
    token,
    userInfo,
    stoBiUserInfo,
    sid,
    savedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
    apiBase,
  };
  cachedAuth = auth;
  console.info('[finance-bi][我的报表1][auth] 已存储（对齐 preview localStorage）', {
    'auth.tokenPrefix': `${token.slice(0, 16)}…`,
    'auth.tokenLength': token.length,
    'auth.userInfo.keys': Object.keys(userInfo),
    'stoBiUserInfo.keys': Object.keys(stoBiUserInfo),
    'auth.sid': sid ?? null,
    'auth.time': auth.savedAt,
    apiBase,
  });
  logger.info('[finance-bi][我的报表1][auth] saved like preview', {
    tokenLength: token.length,
    userInfoKeys: Object.keys(userInfo),
    hasSid: Boolean(sid),
    apiBase,
  });
  return auth;
}

/**
 * 业务请求头：只保留 preview 拦截器里的 `x-bi-token`（另加 sid / Accept-Language）。
 */
export function buildFinanceBiAuthHeaders(auth: CachedBiAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Accept-Language': 'zh-CN',
    [HEADER_TOKEN]: auth.token,
  };
  if (auth.sid) {
    headers[HEADER_SID] = auth.sid;
  }
  return headers;
}

function logOutgoingHeaders(phase: string, path: string, headers: Record<string, string>) {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/token|cookie/i.test(k)) {
      safe[k] = `${v.slice(0, 16)}…(len=${v.length})`;
    } else {
      safe[k] = v;
    }
  }
  console.info(`[finance-bi][我的报表1][headers] ${phase}`, { path, headers: safe });
  logger.info(`[finance-bi][我的报表1][headers] ${phase}`, { path, headers: safe });
}

/**
 * SSO SDK 路径：换票后调 getuserroles，让服务端再次 validate + 写入 Redis。
 * 白名单接口，不依赖已缓存 token。
 */
async function warmTokenViaGetUserRoles(auth: CachedBiAuth): Promise<void> {
  const url = `${auth.apiBase}/sso/login/getuserroles`;
  const headers = {
    Accept: 'application/json',
    [HEADER_TOKEN]: auth.token,
  };
  logOutgoingHeaders('getuserroles', '/sso/login/getuserroles', headers);
  try {
    const response = await fetch(url, { method: 'GET', headers });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep text
    }
    console.info('[finance-bi][我的报表1][auth] getuserroles 结果', {
      httpStatus: response.status,
      body,
    });
  } catch (error) {
    logger.warn('[finance-bi] getuserroles warm failed (non-fatal)', error);
  }
}

/**
 * 对齐 preview `/login`：
 * POST {BI}/login/sto/exchange
 * body: { authorizationCode, code }
 * 成功后存 stoToken，并带齐请求头
 */
async function exchangeCodeForBiToken(
  code: string,
  apiBase: string,
  skipLoginUrl?: string,
): Promise<CachedBiAuth> {
  const url = `${apiBase}/login/sto/exchange`;
  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const requestBody = { authorizationCode: code, code };
  lastExchangeDebug = {
    at: new Date().toISOString(),
    exchangeApiFullUrl: url,
    code,
    apiBase,
    skipLoginUrl: skipLoginUrl || null,
    exchangeHttpStatus: null,
    exchangeOk: null,
    exchangeBody: null,
    tokenPrefix: null,
    tokenLength: null,
    sid: null,
    requestMethod: 'POST',
    requestHeaders,
    requestBody,
  };

  console.info('[finance-bi][我的报表1][exchange] 换票调用接口全称 =', url);
  console.info('[finance-bi][我的报表1][exchange] 换票接口全部入参 =', {
    method: 'POST',
    url,
    headers: requestHeaders,
    body: requestBody,
    skipLoginUrl: skipLoginUrl || null,
  });
  logger.info('[finance-bi][我的报表1][exchange] 换票前全部入参', {
    method: 'POST',
    url,
    headers: requestHeaders,
    body: requestBody,
    skipLoginUrl: skipLoginUrl || null,
    codeLength: code.length,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    lastExchangeDebug = {
      ...lastExchangeDebug!,
      exchangeHttpStatus: response.status,
      exchangeOk: false,
      exchangeBody: text.slice(0, 500),
      error: '响应非 JSON',
    };
    console.error('[finance-bi][我的报表1][exchange] 换票后结果（非 JSON）', {
      httpStatus: response.status,
      body: text.slice(0, 500),
    });
    throw new Error(`BI 换票响应无法解析: HTTP ${response.status} body=${text.slice(0, 120)}`);
  }

  lastExchangeDebug = {
    ...lastExchangeDebug!,
    exchangeHttpStatus: response.status,
    exchangeOk: response.ok,
    exchangeBody: json,
  };

  console.info('[finance-bi][我的报表1][exchange] 换票后结果 =', {
    httpStatus: response.status,
    ok: response.ok,
    body: json,
  });
  logger.info('[finance-bi][我的报表1][exchange] 换票后', {
    httpStatus: response.status,
    ok: response.ok,
    body: json,
  });

  if (!response.ok) {
    lastExchangeDebug = { ...lastExchangeDebug!, error: extractErrorMessage(json, `HTTP ${response.status}`) };
    throw new Error(extractErrorMessage(json, `BI 换票失败 HTTP ${response.status}`));
  }
  const codeVal = json.code;
  if (codeVal != null && Number(codeVal) !== 0 && Number(codeVal) !== 200) {
    lastExchangeDebug = { ...lastExchangeDebug!, error: extractErrorMessage(json, `code=${codeVal}`) };
    throw new Error(extractErrorMessage(json, `BI 换票业务失败 code=${codeVal}`));
  }

  // preview: const data = res?.data
  const data = (json.data && typeof json.data === 'object'
    ? json.data
    : json) as Record<string, unknown>;

  if (data.status === false) {
    lastExchangeDebug = {
      ...lastExchangeDebug!,
      error: extractErrorMessage(data, '换票失败，请重试或联系管理员'),
    };
    throw new Error(extractErrorMessage(data, '换票失败，请重试或联系管理员'));
  }

  const token = pickToken(data);
  const userInfo = pickUserInfo(data);
  const sid = pickSid(data);
  lastExchangeDebug = {
    ...lastExchangeDebug!,
    tokenPrefix: token ? `${token.slice(0, 16)}…` : null,
    tokenLength: token?.length ?? 0,
    sid: sid ?? null,
  };

  if (!token) {
    lastExchangeDebug = { ...lastExchangeDebug!, error: '未获取到 token' };
    throw new Error('换票失败：未获取到 token（响应无 StoToken/stoToken）');
  }

  // 对齐 preview login: saveAuthToLocalStorage(token, userInfo) + saveStoBiUserInfo(data)
  const auth = saveAuthLikePreview(token, userInfo, data, apiBase, sid);
  lastExchangeDebug = {
    ...lastExchangeDebug!,
    requestHeadersPreview: Object.fromEntries(
      Object.entries(buildFinanceBiAuthHeaders(auth)).map(([k, v]) => [
        k,
        /token|cookie/i.test(k) ? `${v.slice(0, 16)}…(len=${v.length})` : v,
      ]),
    ),
  };

  // 对齐 SSO SDK：用 x-bi-token 再拉一次 getuserroles，确保 Redis 有缓存
  await warmTokenViaGetUserRoles(auth);

  return auth;
}

/**
 * 与 preview `/login` 一致：先拿免登 code，再调 BI exchange。
 */
async function refreshBiAuthViaExchange(): Promise<CachedBiAuth> {
  const plaza = getAppPlazaService();
  const envelope = await plaza.getSkipLoginLink(STO_FINANCE_BI_SYSTEM_CODE);
  const rawSkipLoginUrl = typeof envelope.data === 'string' ? envelope.data : '';
  if (!rawSkipLoginUrl) {
    throw new Error('免登接口未返回 skip-login URL');
  }

  const skipLoginUrl = rawSkipLoginUrl.replace(/https:\/\/page-test\.sto\.cn/g, 'https://page.sto.cn');

  const code = extractSkipLoginCode(skipLoginUrl) || extractSkipLoginCode(rawSkipLoginUrl);
  if (!code) {
    throw new Error(`免登链接中未解析到 code：${rawSkipLoginUrl.slice(0, 160)}`);
  }

  const apiBase = resolveFinanceBiApiBaseFromPageUrl(skipLoginUrl);

  console.info('[finance-bi][我的报表1][exchange] 免登 ticket → code', {
    rawSkipLoginUrl,
    alignedSkipLoginUrl: skipLoginUrl,
    code,
    apiBase,
  });
  logger.info('[finance-bi][我的报表1][exchange] skip-login ready', {
    rawSkipLoginUrl,
    alignedSkipLoginUrl: skipLoginUrl,
    code,
    apiBase,
  });

  return exchangeCodeForBiToken(code, apiBase, skipLoginUrl);
}

export async function ensureFinanceBiAuth(options?: { force?: boolean }): Promise<CachedBiAuth> {
  if (!options?.force && cachedAuth && cachedAuth.expiresAt > Date.now()) {
    return cachedAuth;
  }
  if (inflight) return inflight;
  inflight = refreshBiAuthViaExchange()
    .then((auth) => {
      cachedAuth = auth;
      logger.info('[finance-bi] auth ready via /login/sto/exchange', { apiBase: auth.apiBase });
      return auth;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function clearFinanceBiAuth(): void {
  cachedAuth = null;
  console.info('[finance-bi][我的报表1][auth] cleared（对齐 preview clearAuth）');
}

/**
 * 调用财务 BI 业务接口；遇 401 清缓存并重新 exchange 一次。
 */
export async function financeBiFetchJson<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const method = init?.method || 'POST';
  const isListCall = path.includes('/modelMenu/list');

  const doRequest = async (auth: CachedBiAuth, attempt: number) => {
    const url = `${auth.apiBase}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = buildFinanceBiAuthHeaders(auth);

    if (isListCall) {
      console.info('[finance-bi][我的报表1][list] ========== 换票后调用列表接口 ==========');
      console.info('[finance-bi][我的报表1][list] 入参 body =', init?.body ?? null);
      console.info('[finance-bi][我的报表1][list] 入参 请求头 =', headers);
      console.info('[finance-bi][我的报表1][list] 请求 URL / method =', { url, method, attempt });
      logger.info('[finance-bi][我的报表1][list] request', {
        url,
        method,
        attempt,
        body: init?.body ?? null,
        headers,
      });
      lastListCallDebug = {
        at: new Date().toISOString(),
        url,
        method,
        requestBody: init?.body ?? null,
        requestHeaders: { ...headers },
        httpStatus: null,
        ok: null,
        responseBody: null,
      };
    } else {
      logOutgoingHeaders('biz-request', path, headers);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      if (isListCall) {
        console.error('[finance-bi][我的报表1][list] 出参（非 JSON）=', {
          httpStatus: response.status,
          body: text.slice(0, 800),
        });
        lastListCallDebug = {
          ...lastListCallDebug!,
          httpStatus: response.status,
          ok: false,
          responseBody: text.slice(0, 800),
          error: '响应非 JSON',
        };
      }
      throw Object.assign(new Error(`BI 响应无法解析: HTTP ${response.status}`), {
        statusCode: response.status,
      });
    }

    if (isListCall) {
      console.info('[finance-bi][我的报表1][list] 出参 =', {
        httpStatus: response.status,
        ok: response.ok,
        body: json,
      });
      logger.info('[finance-bi][我的报表1][list] response', {
        httpStatus: response.status,
        ok: response.ok,
        body: json,
      });
      lastListCallDebug = {
        ...lastListCallDebug!,
        httpStatus: response.status,
        ok: response.ok,
        responseBody: json,
      };
    }

    return { response, json, url };
  };

  let auth = await ensureFinanceBiAuth();
  let { response, json } = await doRequest(auth, 1);

  const unauthorized =
    response.status === 401
    || Number(json.code) === 401
    || Number(json.code) === 80001;

  if (unauthorized) {
    clearFinanceBiAuth();
    auth = await ensureFinanceBiAuth({ force: true });
    ({ response, json } = await doRequest(auth, 2));
  }

  if (!response.ok) {
    if (isListCall && lastListCallDebug) {
      lastListCallDebug = {
        ...lastListCallDebug,
        error: extractErrorMessage(json, `HTTP ${response.status}`),
      };
    }
    throw Object.assign(
      new Error(extractErrorMessage(json, `HTTP ${response.status}`)),
      { statusCode: response.status },
    );
  }

  const bizCode = json.code;
  if (bizCode != null && Number(bizCode) !== 0 && Number(bizCode) !== 200) {
    if (isListCall && lastListCallDebug) {
      lastListCallDebug = {
        ...lastListCallDebug,
        error: extractErrorMessage(json, `业务失败 code=${bizCode}`),
      };
    }
    throw Object.assign(
      new Error(extractErrorMessage(json, `业务失败 code=${bizCode}`)),
      { statusCode: Number(bizCode) || 500 },
    );
  }

  return (json.data !== undefined ? json.data : json) as T;
}
