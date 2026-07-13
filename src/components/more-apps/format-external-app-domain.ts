/** Display hostname only for external app URLs (no path/query). */
export function formatExternalAppDomain(url: string): string {
  const trimmed = url?.trim();
  if (!trimmed) return '';

  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] ?? trimmed;
  }
}
