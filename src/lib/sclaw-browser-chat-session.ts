/** Persistent chat sessions for the in-app browser drawer (hidden from sidebar, keyed by app). */

export const SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX = 'agent:main:session-embed-app-';

/** Separator between appId and conversationId in multi-session keys. */
export const SCLAW_BROWSER_APP_CHAT_CONV_SEPARATOR = '--';

/** @deprecated Legacy runtime-scoped keys — still hidden from sidebar. */
export const SCLAW_BROWSER_LEGACY_RUNTIME_SESSION_PREFIX = 'agent:main:session-embed-br-';

export function createSclawBrowserEmbedRuntimeId(): string {
  return `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSclawBrowserEmbedConversationId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function sanitizeAppIdForSessionKey(appId: string): string {
  const normalized = appId
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
  return normalized || 'unknown';
}

function sanitizeConversationId(conversationId: string): string {
  const normalized = conversationId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return normalized || createSclawBrowserEmbedConversationId();
}

/** Stable session key for one conversation under an app. */
export function createSclawBrowserChatSessionKeyForApp(
  appId: string,
  conversationId?: string,
): string {
  const safeAppId = sanitizeAppIdForSessionKey(appId);
  if (!conversationId) {
    // Legacy single-session key (kept for backward compatibility).
    return `${SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX}${safeAppId}`;
  }
  const safeConvId = sanitizeConversationId(conversationId);
  return `${SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX}${safeAppId}${SCLAW_BROWSER_APP_CHAT_CONV_SEPARATOR}${safeConvId}`;
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
  const rest = sessionKey.slice(SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX.length).trim();
  if (!rest) return null;
  const sep = rest.indexOf(SCLAW_BROWSER_APP_CHAT_CONV_SEPARATOR);
  if (sep < 0) return rest;
  return rest.slice(0, sep) || null;
}

export function parseSclawBrowserEmbedConversationId(sessionKey: string): string | null {
  if (!sessionKey.startsWith(SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX)) return null;
  const rest = sessionKey.slice(SCLAW_BROWSER_APP_CHAT_SESSION_PREFIX.length).trim();
  const sep = rest.indexOf(SCLAW_BROWSER_APP_CHAT_CONV_SEPARATOR);
  if (sep < 0) return 'default';
  const conversationId = rest.slice(sep + SCLAW_BROWSER_APP_CHAT_CONV_SEPARATOR.length).trim();
  return conversationId || null;
}

export function isSclawBrowserEmbedChatSessionForApp(sessionKey: string, appId: string): boolean {
  const parsed = parseSclawBrowserEmbedAppId(sessionKey);
  return parsed === sanitizeAppIdForSessionKey(appId);
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
