/** Ephemeral chat sessions for the in-app browser drawer (hidden from sidebar). */

export const SCLAW_BROWSER_CHAT_SESSION_PREFIX = 'agent:main:session-embed-';

export function createSclawBrowserEmbedRuntimeId(): string {
  return `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Session key encodes embed runtime id — chat session is bound to the left webview. */
export function createSclawBrowserChatSessionKey(runtimeId: string): string {
  return `${SCLAW_BROWSER_CHAT_SESSION_PREFIX}${runtimeId}`;
}

export function isSclawBrowserEmbedChatSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith(SCLAW_BROWSER_CHAT_SESSION_PREFIX);
}

export function parseSclawBrowserEmbedRuntimeId(sessionKey: string): string | null {
  if (!isSclawBrowserEmbedChatSessionKey(sessionKey)) return null;
  const runtimeId = sessionKey.slice(SCLAW_BROWSER_CHAT_SESSION_PREFIX.length).trim();
  return runtimeId || null;
}
