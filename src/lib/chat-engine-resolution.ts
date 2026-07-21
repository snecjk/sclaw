import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import {
  isAnyCronSessionKey,
  isClaudeScheduledTaskDatedSessionKey,
  isClaudeScheduledTaskRunSessionKey,
  isClaudeScheduledTaskSessionKey,
  isScheduledTaskSessionKey,
} from '@/stores/chat/cron-session-utils';

export type ChatEngineType = 'openclaw' | 'claude';

function normalizeEngineType(value: unknown): ChatEngineType | undefined {
  return value === 'claude' || value === 'openclaw' ? value : undefined;
}

export function resolveChatEngineType(input: {
  sessionKey?: string | null;
  sessionEngineType?: ChatEngineType | string | null;
  agentEngineType?: ChatEngineType | string | null;
  /** Preserve store behavior for DEFAULT_SESSION_KEY: agent default wins. */
  defaultSessionUsesAgent?: boolean;
  /** Preserve UI behavior: session.engineType wins before key-prefix inference. */
  sessionEngineFirst?: boolean;
  /** Force cron/scheduled-task keys to OpenClaw when no more specific behavior is desired. */
  inferOpenClawTaskKeys?: boolean;
}): ChatEngineType {
  const sessionEngine = normalizeEngineType(input.sessionEngineType);
  const agentEngine = normalizeEngineType(input.agentEngineType);
  const sessionKey = input.sessionKey ?? undefined;

  if (input.sessionEngineFirst && sessionEngine) {
    return sessionEngine;
  }

  if (sessionKey === DEFAULT_SESSION_KEY && input.defaultSessionUsesAgent) {
    return agentEngine ?? 'openclaw';
  }

  if (
    sessionKey
    && (
      isClaudeScheduledTaskSessionKey(sessionKey)
      || isClaudeScheduledTaskRunSessionKey(sessionKey)
      || isClaudeScheduledTaskDatedSessionKey(sessionKey)
    )
  ) {
    return 'claude';
  }

  if (
    sessionKey
    && input.inferOpenClawTaskKeys
    && (isAnyCronSessionKey(sessionKey) || isScheduledTaskSessionKey(sessionKey))
  ) {
    return 'openclaw';
  }

  if (sessionEngine) {
    return sessionEngine;
  }

  return agentEngine ?? 'openclaw';
}
