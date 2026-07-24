/**
 * Resolve embed URL for the in-app browser (SSO token injection, useStoToken).
 */
import { getWorkflowStoToken } from '@/lib/workflow-api';
import {
  injectStoSsoWebAutoLogin,
  isStoSsoWebUrl,
  parseStoSsoWebUrl,
} from '@/lib/sto-policy-web-url';

/**
 * Resolve embed URL for the in-app browser.
 * - sto-sso-web entry → inject autoLogin + token when available
 * - useStoToken=1 → strip flag and append stotoken (any host; config URL as-is otherwise)
 */
export function resolveSclawBrowserUrl(url: string): string {
  const trimmed = url?.trim();
  if (!trimmed) return trimmed;

  const token = getWorkflowStoToken();

  const ssoMeta = parseStoSsoWebUrl(trimmed);
  if (ssoMeta?.systemCode === 'sto-policy') {
    if (token) {
      return injectStoSsoWebAutoLogin(trimmed, token);
    }
    return trimmed;
  }

  if (token && isStoSsoWebUrl(trimmed)) {
    return injectStoSsoWebAutoLogin(trimmed, token);
  }

  try {
    const isAbsolute = /^https?:\/\//i.test(trimmed);
    const parsed = new URL(trimmed, isAbsolute ? undefined : 'https://stoclaw.local');

    if (parsed.searchParams.get('useStoToken') !== '1') {
      return trimmed;
    }

    parsed.searchParams.delete('useStoToken');

    if (token) {
      parsed.searchParams.set('stotoken', token);
    }

    if (isAbsolute) {
      return parsed.toString();
    }

    const path = trimmed.split(/[?#]/, 1)[0] ?? parsed.pathname.replace(/^\//, '');
    return `${path}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}
