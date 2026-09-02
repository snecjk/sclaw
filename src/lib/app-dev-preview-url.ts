const LEGACY_AUTH_QUERY_KEYS = [
  'stoToken',
  'stotoken',
  'StoToken',
  'token',
  'code',
  'authorizationCode',
] as const;

/** Remove legacy URL-based preview auth while preserving business Query and Hash. */
export function stripLegacyAppDevPreviewAuth(url: string): string {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    let changed = false;
    for (const key of LEGACY_AUTH_QUERY_KEYS) {
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
