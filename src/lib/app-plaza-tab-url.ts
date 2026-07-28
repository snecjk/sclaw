/**
 * App Plaza multi-tab URL helpers — normalize for reuse matching (origin + pathname + search, ignore hash).
 */

/** Normalize a user/catalog URL for tab reuse comparison. Returns '' if empty/invalid. */
export function normalizeAppPlazaTabUrl(input: string): string {
  const trimmed = input?.trim();
  if (!trimmed) return '';

  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return trimmed.toLowerCase();
    }
    parsed.hash = '';
    // Normalize default ports away
    if (
      (parsed.protocol === 'http:' && parsed.port === '80')
      || (parsed.protocol === 'https:' && parsed.port === '443')
    ) {
      parsed.port = '';
    }
    // Trailing slash on pathname root only keep as `/`; strip trailing slash on longer paths
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Ensure http(s) absolute URL for navigation; returns null if unusable. */
export function coerceAppPlazaNavigableUrl(input: string): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function appPlazaTabUrlsMatch(a: string, b: string): boolean {
  const na = normalizeAppPlazaTabUrl(a);
  const nb = normalizeAppPlazaTabUrl(b);
  return Boolean(na) && na === nb;
}
