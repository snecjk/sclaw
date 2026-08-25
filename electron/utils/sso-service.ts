/**
 * SSO Service
 * Stateless module handling all HTTP calls to the STO SSO backend.
 */

import type { SsoEnvironment, SsoUserInfo } from './auth-store';
import { normalizeSsoRoleCodes } from '../../shared/sso-roles';
import { proxyAwareFetch } from './proxy-fetch';
import { logger } from './logger';
import { toCSTISOString } from './time-utils';


export const SSO_ENVIRONMENTS: Record<SsoEnvironment, string> = {
  'daily-external': 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
  'production-external': 'https://baseinfo-usercenterserviceapi.sto.cn',
  'pre-release': 'https://pre-baseinfo-usercenterservice-api-hq.sto.cn',
  // Local env uses the same SSO server as daily-external
  'local': 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
};

export const SYSTEM_CODE = 'sto_claw';

/**
 * Get the base URL for a given SSO environment.
 */
export function getBaseUrl(env: SsoEnvironment): string {
  return SSO_ENVIRONMENTS[env];
}

/**
 * Build the SSO login page URL.
 */
export function buildLoginUrl(baseUrl: string, callbackUrl: string): string {
  const params = new URLSearchParams({
    autoLogin: 'false',
    systemCode: SYSTEM_CODE,
    returnUrl: callbackUrl,
  });
  return `${baseUrl}/Authenticate/Login?${params.toString()}`;
}

/**
 * Decode the payload of a JWT (no signature verification) and return the
 * parsed JSON object.  Returns `null` when the token is not a valid JWT.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Exchange a temporary authorization code for user info.
 */
export async function exchangeCodeForUser(
  baseUrl: string,
  code: string,
): Promise<SsoUserInfo> {
  const params = new URLSearchParams({
    systemCode: 'UI',
    categoryCode: SYSTEM_CODE,
    authorizationCode: code,
    getRoles: 'true',
    getModules: 'false',
  });
  const url = `${baseUrl}/WebAPIV46/API/LogOn/logOnByAuthorizationCodeForClaw?${params.toString()}`;

  const response = await proxyAwareFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`SSO code exchange failed: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.Status || data.StatusCode !== 'OK') {
    throw new Error(data.StatusMessage || 'SSO code exchange failed');
  }

  const u = data.UserInfo;
  if (!u) {
    throw new Error('SSO response missing UserInfo');
  }

  const now = new Date();
  const stoToken: string = data.StoToken ?? '';

  // Derive expiry from the JWT `exp` claim; fall back to 7 days if the
  // token is not a valid JWT or the `exp` field is missing.
  // Subtract 5 minutes so the client expires before the server, avoiding
  // edge-case requests with an almost-expired token.
  const LOCAL_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
  let expiresAt: Date;
  const jwtPayload = stoToken ? decodeJwtPayload(stoToken) : null;
  if (jwtPayload && typeof jwtPayload.exp === 'number') {
    expiresAt = new Date(jwtPayload.exp * 1000 - LOCAL_EXPIRY_BUFFER_MS);
    logger.info(`StoToken JWT exp: ${toCSTISOString(new Date(jwtPayload.exp * 1000))}, local expiry (−5min): ${toCSTISOString(expiresAt)}`);
  } else {
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 - LOCAL_EXPIRY_BUFFER_MS);
    logger.info('StoToken is not a JWT or missing exp claim, falling back to 7-day expiry (−5min)');
  }

  return {
    id: u.Id ?? '',
    userName: u.UserName ?? '',
    realName: u.RealName ?? '',
    code: u.Code ?? '',
    empCode: u.EmpCode ?? '',
    companyId: u.CompanyId ?? '',
    companyCode: u.CompanyCode ?? '',
    companyName: u.CompanyName ?? '',
    departmentId: u.DepartmentId ?? '',
    departmentCode: u.DepartmentCode ?? '',
    departmentName: u.DepartmentName ?? '',
    categoryCode: u.CategoryCode ?? '',
    isAdministrator: Boolean(u.IsAdministrator ?? false),
    roles: normalizeSsoRoleCodes(data.Roles),
    loginMode: u.LoginMode ?? '',
    openId: u.OpenId ?? '',
    signature: u.Signature ?? '',
    authenticatedAt: toCSTISOString(now),
    stoToken,
    stoTokenExpiresAt: toCSTISOString(expiresAt),
  };
}

/**
 * Sign out from SSO (best-effort).
 */
export async function signOut(
  baseUrl: string,
  openId: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      systemCode: SYSTEM_CODE,
      openId,
    });
    const url = `${baseUrl}/webapiv46/api/logon/signOut?${params.toString()}`;
    logger.info("signOut ", url)
    const response = await proxyAwareFetch(url, { method: 'GET' });
    if (!response.ok) return false;

    const data = await response.json();
    return data.Status === true;
  } catch {
    // Best-effort: don't fail the logout flow if SSO server is unreachable
    return false;
  }
}
