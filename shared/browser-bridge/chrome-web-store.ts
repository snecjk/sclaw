/**
 * Chrome Web Store listing for SClaw Web Bridge.
 * Leave empty until the listing is approved; the in-app guide then
 * falls back to load-unpacked. After publish, paste the https detail URL.
 */
export const SCLAW_WEB_BRIDGE_CHROME_WEB_STORE_URL = '';

const STORE_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com']);

export function parseSclawWebBridgeChromeWebStoreUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (!STORE_HOSTS.has(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getSclawWebBridgeChromeWebStoreUrl(): string | null {
  return parseSclawWebBridgeChromeWebStoreUrl(SCLAW_WEB_BRIDGE_CHROME_WEB_STORE_URL);
}

