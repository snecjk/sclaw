/** Persistent chat sessions for the in-app browser drawer (hidden from sidebar, keyed by app). */

export const SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX = 'agent:main:session-embed-app-';

/** @deprecated Legacy runtime-scoped keys — still hidden from sidebar. */
export const SCLAW_BROWSER_LEGACY_RUNTIME_SESSION_PREFIX = 'agent:main:session-embed-br-';

export function createSclawBrowserEmbedRuntimeId(): string {
  return `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeAppIdForSessionKey(appId: string): string {
  const normalized = appId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return normalized || 'unknown';
}

/** Stable session key per 应用广场 app — history survives drawer close/reopen. */
export function createSclawBrowserChatSessionKeyForApp(appId: string): string {
  return `${SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX}${sanitizeAppIdForSessionKey(appId)}`;
}

export function deriveSclawBrowserAppId(input: { appId?: string; url: string }): string {
  if (input.appId?.trim()) return sanitizeAppIdForSessionKey(input.appId);
  try {
    const parsed = new URL(input.url);
    const pathKey = parsed.pathname.replace(/^\//, '').replace(/\//g, '-') || 'root';
    return sanitizeAppIdForSessionKey(`url-${parsed.hostname}-${pathKey}`);
  } catch {
    return sanitizeAppIdForSessionKey(`url-${input.url.slice(0, 48)}`);
  }
}

export function isSclawBrowserEmbedChatSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith(SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX)
    || sessionKey.startsWith(SCLAW_BROWSER_LEGACY_RUNTIME_SESSION_PREFIX);
}

export function parseSclawBrowserEmbedAppId(sessionKey: string): string | null {
  if (!sessionKey.startsWith(SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX)) return null;
  const appId = sessionKey.slice(SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX.length).trim();
  return appId || null;
}

/** @deprecated Prefer overlay store runtime id; legacy keys only. */
export function parseSclawBrowserEmbedRuntimeId(sessionKey: string): string | null {
  if (!sessionKey.startsWith(SCLAW_BROWSER_LEGACY_RUNTIME_SESSION_PREFIX)) return null;
  const runtimeId = sessionKey.slice(SCLAW_BROWSER_LEGACY_RUNTIME_SESSION_PREFIX.length).trim();
  return runtimeId || null;
}

/** @deprecated Use createSclawBrowserChatSessionKeyForApp */
export function createSclawBrowserChatSessionKey(runtimeId: string): string {
  return `${SCLAW_BROWSER_LEGACY_RUNTIME_SESSION_PREFIX}${runtimeId}`;
}
