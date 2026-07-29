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
 * - useStoToken=1 → strip flag and append `stotoken=<token>` (existing behavior)
 * - useStoToken=<name> (any other non-empty value) → strip flag and append `<name>=<token>`
 * - Preserves other existing search params on the URL
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

    const useStoTokenFlag = parsed.searchParams.get('useStoToken');
    if (useStoTokenFlag == null || useStoTokenFlag === '') {
      return trimmed;
    }

    parsed.searchParams.delete('useStoToken');

    // useStoToken=1 → classic `stotoken`; otherwise the flag value is the query key.
    const tokenParamName = useStoTokenFlag === '1' ? 'stotoken' : useStoTokenFlag;

    if (token) {
      parsed.searchParams.set(tokenParamName, token);
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
