/**
 * Bridge AI chat session keys.
 *
 * Shape follows the established SClaw convention of a category discriminator at
 * `parts[2]`, same as `agent:{id}:cron:{jobId}`, `agent:{id}:scheduled-task:...`
 * and `agent:{id}:dingtalk:{peerId}:{ts}:{nonce}`:
 *
 *   agent:{agentId}:bridge-ai:{appId}:{conversationId}
 *
 * Shared between main and renderer: main constructs keys, the renderer uses the
 * same predicate to keep these sessions out of the sidebar. Keeping both sides
 * on one module avoids an implicit cross-process contract that fails silently.
 *
 * All segments are lowercased because the OpenClaw Gateway normalizes session
 * keys to lowercase; a mixed-case key would make delivery listeners miss
 * gateway events (see electron/message-channel/common/session-key.ts).
 */

export const BRIDGE_AI_SESSION_CATEGORY = 'bridge-ai';

const MAX_APP_ID_LENGTH = 80;
const MAX_CONVERSATION_ID_LENGTH = 40;

function normalizeAgentSegment(agentId: string | undefined | null): string {
  return (agentId ?? '').trim().replace(/:/g, '_').toLowerCase() || 'main';
}

/** Colons would break `agent:{id}:bridge-ai:...` segmentation. */
function normalizeSegment(value: string, maxLength: number, fallback: string): string {
  const normalized = value.trim().replace(/:/g, '_').toLowerCase().slice(0, maxLength);
  return normalized || fallback;
}

export function createBridgeAiConversationId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createBridgeAiSessionKey(
  agentId: string,
  appId: string,
  conversationId?: string,
): string {
  const safeAgentId = normalizeAgentSegment(agentId);
  const safeAppId = normalizeSegment(appId, MAX_APP_ID_LENGTH, 'unknown');
  const safeConversationId = normalizeSegment(
    conversationId ?? createBridgeAiConversationId(),
    MAX_CONVERSATION_ID_LENGTH,
    createBridgeAiConversationId(),
  );
  return `agent:${safeAgentId}:${BRIDGE_AI_SESSION_CATEGORY}:${safeAppId}:${safeConversationId}`;
}

export interface ParsedBridgeAiSessionKey {
  agentId: string;
  appId: string;
  conversationId: string;
}

export function parseBridgeAiSessionKey(sessionKey: string): ParsedBridgeAiSessionKey | null {
  const parts = sessionKey.trim().split(':');
  if (parts.length < 5) return null;
  if (parts[0] !== 'agent' || parts[2] !== BRIDGE_AI_SESSION_CATEGORY) return null;
  const agentId = parts[1]?.trim();
  const appId = parts[3]?.trim();
  const conversationId = parts[4]?.trim();
  if (!agentId || !appId || !conversationId) return null;
  return { agentId, appId, conversationId };
}

/** True for Bridge AI sessions, which must stay out of the sidebar. */
export function isBridgeAiChatSessionKey(sessionKey: string): boolean {
  return parseBridgeAiSessionKey(sessionKey) !== null;
}

export function isBridgeAiChatSessionForApp(sessionKey: string, appId: string): boolean {
  const parsed = parseBridgeAiSessionKey(sessionKey);
  if (!parsed) return false;
  return parsed.appId === normalizeSegment(appId, MAX_APP_ID_LENGTH, 'unknown');
}
