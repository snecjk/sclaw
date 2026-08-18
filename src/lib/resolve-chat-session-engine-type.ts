import type { ChatEngineType } from '@/lib/chat-engine-resolution';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import {
  isClaudeScheduledTaskRunSessionKey,
  isClaudeScheduledTaskSessionKey,
  isAnyCronSessionKey,
} from '@/stores/chat/cron-session-utils';
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
  // Infer from the session key prefix so task/cron sessions resolve correctly
  // even before the run's transcript is materialized on disk — e.g. the race
  // window right after "立即运行", where the dated aggregate session is not
  // yet in the list and the agent fallback would otherwise mislabel a
  // `claude-task:*` key as OpenClaw (it resolves to the `main` agent).
  // Mirrors the key-prefix detection used by loadHistory.
  if (sessionKey && (isClaudeScheduledTaskSessionKey(sessionKey) || isClaudeScheduledTaskRunSessionKey(sessionKey))) {
    return 'claude';
  }
  // OpenClaw cron session keys are inherently openclaw — claude tasks use the
  // separate `claude-task:*` format. Inferring from the key prefix avoids
  // mirroring the main agent's persisted (home-composer) engine for a freshly
  // triggered `agent:*:cron:*` dated session whose entry may not yet carry an
  // engineType.
  if (sessionKey && isAnyCronSessionKey(sessionKey)) {
    return 'openclaw';
  }
  if (sessionKey === DEFAULT_SESSION_KEY) {
    return normalizeAgentEngineType(agentEngineType);
  }

  // Unused embed chat mirrors the home empty slot: toolbar shows agent default
  // and can switch engine; send/model must use that same engine — not a leftover
  // OpenClaw stamp from the previous non-embed session or a hard-coded persist.
  if (
    sessionKey
    && isSclawBrowserEmbedChatSessionKey(sessionKey)
    && options?.messageCount === 0
  ) {
    return normalizeAgentEngineType(agentEngineType);
  }

  if (session?.engineType === 'claude' || session?.engineType === 'openclaw') {
    return session.engineType;
  }
  return normalizeAgentEngineType(agentEngineType);
}

/** Engine for a newly activated / still-empty embed conversation. */
export function resolveUnusedEmbedChatEngineType(
  agentEngineType?: ChatEngineType | string | null,
): ChatEngineType {
  return normalizeAgentEngineType(agentEngineType);
}

/** Empty embed chat (App Plaza) — engine follows agent default until first send. */
export function isUnusedEmbedChatSession(
  sessionKey: string | undefined,
  messageCount: number,
  loading = false,
): boolean {
  return Boolean(
    sessionKey
    && isSclawBrowserEmbedChatSessionKey(sessionKey)
    && !loading
    && messageCount === 0,
  );
}

export type { ChatEngineType };
