import { resolveChatEngineType, type ChatEngineType } from '@/lib/chat-engine-resolution';
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';

export interface ResolveChatSessionEngineTypeOptions {
  /**
   * Message count for the active session. When `0` on an embed chat session,
   * follow the agent default (same contract as the toolbar "unused embed" UI)
   * instead of a stale `session.engineType` inherited from a previous surface.
   */
  messageCount?: number;
}

function normalizeAgentEngineType(agentEngineType?: ChatEngineType | string | null): ChatEngineType {
  return agentEngineType === 'claude' ? 'claude' : 'openclaw';
}

/** Resolve engine for Host API calls; never infer from stale registry on the client. */
export function resolveChatSessionEngineType(
  session: { engineType?: ChatEngineType } | undefined,
  agentEngineType?: ChatEngineType | string | null,
  sessionKey?: string,
  options?: ResolveChatSessionEngineTypeOptions,
): ChatEngineType {
  if (
    sessionKey
    && isSclawBrowserEmbedChatSessionKey(sessionKey)
    && options?.messageCount === 0
  ) {
    return normalizeAgentEngineType(agentEngineType);
  }

  return resolveChatEngineType({
    sessionKey,
    sessionEngineType: session?.engineType,
    agentEngineType,
    defaultSessionUsesAgent: true,
    sessionEngineFirst: true,
    inferOpenClawTaskKeys: true,
  });
}

/** Engine for a newly activated / still-empty embed conversation. */
export function resolveUnusedEmbedChatEngineType(
  agentEngineType?: ChatEngineType | string | null,
): ChatEngineType {
  return normalizeAgentEngineType(agentEngineType);
}

export type { ChatEngineType };
