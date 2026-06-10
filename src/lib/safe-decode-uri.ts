/**
 * decodeURIComponent that never throws — URLSearchParams.get() is already decoded,
 * and OSS filenames may contain literal '%' that are not valid escape sequences.
 */
export function safeDecodeURIComponent(value: string, fallback?: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return fallback ?? value;
  }
}
