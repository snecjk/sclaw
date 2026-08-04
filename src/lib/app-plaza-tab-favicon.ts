/**
 * Resolve a small favicon URL for App Plaza browser tabs (browser-like).
 */
export function resolveAppPlazaFaviconUrl(pageUrl: string): string | undefined {
  const trimmed = pageUrl?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    // Google's favicon service is a practical cross-origin fallback for tab icons.
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=32`;
  } catch {
    return undefined;
  }
}
