import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

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
  if (sessionKey === DEFAULT_SESSION_KEY) {
    return agentEngineType === 'claude' ? 'claude' : 'openclaw';
  }
  return agentEngineType === 'claude' ? 'claude' : 'openclaw';
}
