/**
 * SSO Service
 * Stateless module handling all HTTP calls to the STO SSO backend.
 */

import type { SsoEnvironment, SsoUserInfo } from './auth-store';
import { proxyAwareFetch } from './proxy-fetch';

export const SSO_ENVIRONMENTS: Record<SsoEnvironment, string> = {
  'daily-external': 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
  'production-internal': 'http://baseinfo-usercenterserviceapi.stosystem.com',
  'production-external': 'https://baseinfo-usercenterserviceapi.sto.cn',
  'pre-release': 'https://pre-baseinfo-usercenterservice-api-hq.sto.cn',
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
    getRoles: 'false',
    getModules: 'false',
  });
  const url = `${baseUrl}/WebAPIV46/API/LogOn/LogOnByAuthorizationCode?${params.toString()}`;

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

  return {
    id: u.Id ?? '',
    userName: u.UserName ?? '',
    realName: u.RealName ?? '',
    companyName: u.CompanyName ?? '',
    departmentName: u.DepartmentName ?? '',
    openId: u.OpenId ?? '',
    signature: u.Signature ?? '',
    authenticatedAt: new Date().toISOString(),
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

    const response = await proxyAwareFetch(url, { method: 'GET' });
    if (!response.ok) return false;

    const data = await response.json();
    return data.Status === true;
  } catch {
    // Best-effort: don't fail the logout flow if SSO server is unreachable
    return false;
  }
}
