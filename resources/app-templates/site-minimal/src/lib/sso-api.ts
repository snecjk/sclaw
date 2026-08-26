import type { AppUser, AuthSession, SsoLoginContext } from './session';
import { buildSsoCallbackExchangeUrl } from './sso-config';

export interface SsoUserLogOnResult {
  userInfo?: Record<string, unknown>;
  UserInfo?: Record<string, unknown>;
  roles?: unknown[];
  modules?: unknown[];
  stoToken?: string;
  returnUrl?: string;
  companyCode?: string;
  site?: boolean;
  contractArea?: boolean;
  center?: boolean;
}

export interface SsoExchangeData {
  stoToken?: string;
  returnUrl?: string;
  roles?: unknown[];
  modules?: unknown[];
  userInfo?: Record<string, unknown>;
  UserInfo?: Record<string, unknown>;
  userLogOnResult?: SsoUserLogOnResult;
  openId?: string;
  realName?: string;
  userName?: string;
  empCode?: string;
  id?: string;
}

export interface SsoExchangeResponse {
  status?: boolean;
  success?: boolean;
  statusCode?: string;
  statusMessage?: string;
  data?: SsoExchangeData;
}

function pickString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value != null && value !== '') return String(value);
  }
  return undefined;
}

function pickBoolean(source: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

/** 映射用户中心 / exchange 返回的完整 UserInfo。 */
export function mapSsoUserInfo(info?: Record<string, unknown>): AppUser {
  const record = info ?? {};
  const id = pickString(record, 'Id', 'id', 'EmpCode', 'empCode') || 'unknown';
  const name =
    pickString(record, 'RealName', 'realName', 'NickName', 'nickName', 'UserName', 'userName')
    || '应用用户';

  return {
    id,
    name,
    userName: pickString(record, 'UserName', 'userName'),
    realName: pickString(record, 'RealName', 'realName'),
    nickName: pickString(record, 'NickName', 'nickName'),
    code: pickString(record, 'Code', 'code'),
    empCode: pickString(record, 'EmpCode', 'empCode'),
    openId: pickString(record, 'OpenId', 'openId'),
    accountId: pickString(record, 'AccountId', 'AccountID', 'accountId', 'accountID'),
    companyId: pickString(record, 'CompanyId', 'companyId'),
    companyCode: pickString(record, 'CompanyCode', 'companyCode'),
    companyName: pickString(record, 'CompanyName', 'companyName'),
    categoryCode: pickString(record, 'CategoryCode', 'categoryCode'),
    departmentId: pickString(record, 'DepartmentId', 'departmentId'),
    departmentCode: pickString(record, 'DepartmentCode', 'departmentCode'),
    departmentName: pickString(record, 'DepartmentName', 'departmentName'),
    isAdministrator: pickBoolean(record, 'IsAdministrator', 'isAdministrator'),
    ipAddress: pickString(record, 'IpAddress', 'ipAddress', 'ipaddress'),
    loginMode: pickString(record, 'LoginMode', 'loginMode'),
    signature: pickString(record, 'Signature', 'signature'),
    systemCode: pickString(record, 'SystemCode', 'systemCode'),
    email: pickString(record, 'Email', 'email'),
    avatar: pickString(record, 'Avatar', 'avatar'),
  };
}

function mapExchangeUser(data: SsoExchangeData): AppUser {
  const nested =
    data.userInfo
    || data.UserInfo
    || data.userLogOnResult?.userInfo
    || data.userLogOnResult?.UserInfo;
  if (nested) return mapSsoUserInfo(nested);

  return {
    id: String(data.id || data.empCode || data.openId || 'sso-user'),
    name: String(data.realName || data.userName || '应用用户'),
    empCode: data.empCode,
    openId: data.openId,
    userName: data.userName,
    realName: data.realName,
  };
}

function mapLoginContext(data: SsoExchangeData): SsoLoginContext | undefined {
  const logon = data.userLogOnResult;
  const context: SsoLoginContext = {
    returnUrl: logon?.returnUrl ?? data.returnUrl,
    companyCode: logon?.companyCode,
    site: logon?.site,
    contractArea: logon?.contractArea,
    center: logon?.center,
  };

  if (Object.values(context).some((value) => value !== undefined)) {
    return context;
  }
  return undefined;
}

function extractExchangePayload(raw: SsoExchangeResponse): SsoExchangeData {
  if (raw.data && typeof raw.data === 'object') return raw.data;
  return raw as SsoExchangeData;
}

function isExchangeSuccess(raw: SsoExchangeResponse): boolean {
  if (raw.status === false || raw.success === false) return false;
  return raw.status === true || raw.success === true;
}

export function mapAuthorizationExchangeResponse(raw: SsoExchangeResponse): AuthSession {
  if (!isExchangeSuccess(raw)) {
    throw new Error(raw.statusMessage || 'SSO 登录失败');
  }

  const payload = extractExchangePayload(raw);
  const logon = payload.userLogOnResult;
  const token = (payload.stoToken || logon?.stoToken)?.trim();
  if (!token) {
    throw new Error(raw.statusMessage || 'SSO 未返回 StoToken');
  }

  return {
    token,
    user: mapExchangeUser(payload),
    roles: payload.roles ?? logon?.roles,
    modules: payload.modules ?? logon?.modules,
    loginContext: mapLoginContext(payload),
  };
}

/** GET 用户中心 `/sso/login/callback?code=` 换票（与 portal exchange 返回结构一致）。 */
export async function exchangeSsoAuthorizationCode(code: string): Promise<AuthSession> {
  const url = buildSsoCallbackExchangeUrl(code);
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });

  const text = await response.text();
  let raw: SsoExchangeResponse = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text) as SsoExchangeResponse;
    } catch {
      throw new Error(`换票接口返回非 JSON (${response.status})`);
    }
  } else if (!response.ok) {
    throw new Error(`换票接口异常 (${response.status})`);
  }

  if (!response.ok) {
    const base = raw.statusMessage || `换票接口异常 (${response.status})`;
    const hint = response.status >= 500
      ? '。请确认 VITE_SSO_ENV 与 SSO 登录环境一致（测试/预发/生产）'
      : '';
    throw new Error(`${base}${hint}`);
  }

  return mapAuthorizationExchangeResponse(raw);
}
