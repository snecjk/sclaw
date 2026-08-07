/**
 * App-dev preview auth: inject Claw stoToken into local preview URLs so the
 * generated app can capture it (auth-token.ts) and attach request headers.
 */

const STO_TOKEN_QUERY_KEYS = ['stoToken', 'stotoken', 'StoToken'] as const;

/** Put stoToken on the URL search string; preserves hash routes (#/...). */
export function injectAppDevPreviewStoToken(
  url: string,
  stoToken?: string | null,
): string {
  const trimmed = url?.trim() ?? '';
  const token = typeof stoToken === 'string' ? stoToken.trim() : '';
  if (!trimmed || !token) return trimmed;

  try {
    const parsed = new URL(trimmed);
    for (const key of STO_TOKEN_QUERY_KEYS) {
      parsed.searchParams.delete(key);
    }
    parsed.searchParams.set('stoToken', token);
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

/** Remove stoToken query keys for address-bar display (token stays on mount URL). */
export function stripAppDevPreviewStoToken(url: string): string {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    let changed = false;
    for (const key of STO_TOKEN_QUERY_KEYS) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? parsed.toString() : trimmed;
  } catch {
    return trimmed;
  }
}
