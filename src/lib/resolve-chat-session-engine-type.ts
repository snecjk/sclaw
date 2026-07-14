import { resolveChatEngineType, type ChatEngineType } from '@/lib/chat-engine-resolution';

/** Resolve engine for Host API calls; never infer from stale registry on the client. */
export function resolveChatSessionEngineType(
  session: { engineType?: ChatEngineType } | undefined,
  agentEngineType?: ChatEngineType | string | null,
  sessionKey?: string,
): ChatEngineType {
  return resolveChatEngineType({
    sessionKey,
    sessionEngineType: session?.engineType,
    agentEngineType,
    defaultSessionUsesAgent: true,
    sessionEngineFirst: true,
    inferOpenClawTaskKeys: true,
  });
}

export type { ChatEngineType };
