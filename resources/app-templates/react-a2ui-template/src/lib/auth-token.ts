const STO_TOKEN_STORAGE_KEY = 'sclaw.app.stoToken';
const STO_TOKEN_QUERY_KEYS = ['stoToken', 'stotoken', 'StoToken'] as const;

function readQueryToken(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const key of STO_TOKEN_QUERY_KEYS) {
    const value = params.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

/** Persist URL stoToken into sessionStorage and strip it from the address bar. */
export function captureStoTokenFromUrl(href: string = window.location.href): string | null {
  try {
    const url = new URL(href);
    const token = readQueryToken(url.search);
    if (!token) return getStoToken();

    sessionStorage.setItem(STO_TOKEN_STORAGE_KEY, token);
    for (const key of STO_TOKEN_QUERY_KEYS) {
      url.searchParams.delete(key);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', next);
    return token;
  } catch {
    return getStoToken();
  }
}

export function getStoToken(): string | null {
  try {
    const stored = sessionStorage.getItem(STO_TOKEN_STORAGE_KEY)?.trim();
    return stored || null;
  } catch {
    return null;
  }
}

export function setStoToken(token: string | null): void {
  try {
    if (!token?.trim()) {
      sessionStorage.removeItem(STO_TOKEN_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STO_TOKEN_STORAGE_KEY, token.trim());
  } catch {
    // ignore quota / private mode
  }
}

/** Best-effort display name from JWT payload (no signature verify). */
export function getUserDisplayFromToken(token: string | null = getStoToken()): {
  name: string;
  code?: string;
} {
  if (!token) return { name: '未登录用户' };
  const parts = token.split('.');
  if (parts.length < 2) return { name: '已登录用户' };
  try {
    const normalized = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = atob(padded);
    const payload = JSON.parse(json) as Record<string, unknown>;
    const name =
      pickString(payload.realName, payload.userName, payload.name, payload.nickname)
      ?? '已登录用户';
    const code = pickString(payload.userCode, payload.code, payload.empCode, payload.sub);
    return { name, code };
  } catch {
    return { name: '已登录用户' };
  }
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
