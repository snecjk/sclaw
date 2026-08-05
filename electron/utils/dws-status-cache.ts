/**
 * Process-local cache for dws install/auth probes (mention-search / status routes).
 * Invalidate whenever binary install or auth state changes — including connector
 * ManagedCliRuntime connect (not only /api/dingtalk/install).
 */

const DWS_STATUS_CACHE_TTL_MS = 180_000;

let installedStatusCache: { value: unknown; expiresAt: number } | null = null;
let authStatusCache: { value: boolean; expiresAt: number } | null = null;

export function invalidateDwsStatusCache(): void {
  installedStatusCache = null;
  authStatusCache = null;
}

export async function getCachedDwsInstalled<T>(fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (installedStatusCache && installedStatusCache.expiresAt > now) {
    return installedStatusCache.value as T;
  }
  const value = await fetcher();
  installedStatusCache = { value, expiresAt: now + DWS_STATUS_CACHE_TTL_MS };
  return value;
}

export async function getCachedDwsAuthenticated(fetcher: () => Promise<boolean>): Promise<boolean> {
  const now = Date.now();
  if (authStatusCache && authStatusCache.expiresAt > now) {
    return authStatusCache.value;
  }
  const value = await fetcher();
  authStatusCache = { value, expiresAt: now + DWS_STATUS_CACHE_TTL_MS };
  return value;
}
