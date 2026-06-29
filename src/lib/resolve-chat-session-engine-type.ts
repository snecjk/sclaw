import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import {
  isClaudeScheduledTaskRunSessionKey,
  isClaudeScheduledTaskSessionKey,
  isAnyCronSessionKey,
  isScheduledTaskSessionKey,
} from '@/stores/chat/cron-session-utils';

export type ChatEngineType = 'openclaw' | 'claude';

/** Resolve engine for Host API calls; never infer from stale registry on the client. */
export function resolveChatSessionEngineType(
  session: { engineType?: ChatEngineType } | undefined,
  agentEngineType?: ChatEngineType | string | null,
  sessionKey?: string,
): ChatEngineType {
  if (session?.engineType === 'claude' || session?.engineType === 'openclaw') {
    return session.engineType;
  }
  // Infer from the session key prefix so task/cron sessions resolve correctly
  // even before the run's transcript is materialized on disk — e.g. the race
  // window right after "立即运行", where the dated aggregate session is not
  // yet in the list and the agent fallback would otherwise mislabel a
  // `claude-task:*` key as OpenClaw (it resolves to the `main` agent).
  // Mirrors the key-prefix detection used by loadHistory.
  if (sessionKey && (isClaudeScheduledTaskSessionKey(sessionKey) || isClaudeScheduledTaskRunSessionKey(sessionKey))) {
    return 'claude';
  }
  // OpenClaw cron/scheduled-task session keys are inherently openclaw — claude
  // tasks use the separate `claude-task:*` format. Inferring from the key prefix
  // avoids mirroring the main agent's persisted (home-composer) engine for a
  // freshly triggered `agent:*:cron:*` dated session whose entry may not yet
  // carry an engineType.
  if (sessionKey && (isAnyCronSessionKey(sessionKey) || isScheduledTaskSessionKey(sessionKey))) {
    return 'openclaw';
  }
  if (sessionKey === DEFAULT_SESSION_KEY) {
    return agentEngineType === 'claude' ? 'claude' : 'openclaw';
  }
  return agentEngineType === 'claude' ? 'claude' : 'openclaw';
}
