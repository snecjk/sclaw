/** Electron session partition for in-app browser drawer (persisted cookies). */
export const SCLAW_EMBED_BROWSER_PARTITION = 'persist:sclaw-embedded-browser';

/** Domains whose cookies are synced into the embed session before load. */
export const SCLAW_EMBED_COOKIE_DOMAIN_SUFFIXES = ['.sto.cn', '.stosystem.com'] as const;

export function isStoEmbedBrowserUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.sto.cn') || host.endsWith('.stosystem.com') || host === 'sto.cn';
  } catch {
    return false;
  }
}
