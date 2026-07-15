import { buildDingTalkMentionRpcExtras } from '@/lib/dingtalk-mention-context';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession, SendMessageOptions } from './types';

export async function resolveSendTarget(input: {
  get: ChatGet;
  set: ChatSet;
  targetAgentId?: string | null;
  dingTalkMentions?: SendMessageOptions['dingTalkMentions'];
  attachments?: SendMessageOptions['attachments'];
  resolveMainSessionKeyForAgent: (agentId: string | undefined | null) => string | null;
  buildSessionSwitchPatch: (state: ReturnType<ChatGet>, nextSessionKey: string) => Partial<ReturnType<ChatGet>>;
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
    options?: { messageCount?: number },
  ) => ChatSession['engineType'] | undefined;
}): Promise<{
  sessionKey: string;
  engineType?: ChatSession['engineType'];
  dingTalkRpcExtras: Record<string, unknown>;
}> {
  const {
    attachments,
    buildSessionSwitchPatch,
    dingTalkMentions,
    get,
    resolveEngineTypeForSession,
    resolveMainSessionKeyForAgent,
    set,
    targetAgentId,
  } = input;

  const targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId) ?? get().currentSessionKey;
  if (targetSessionKey !== get().currentSessionKey) {
    set((state) => buildSessionSwitchPatch(state, targetSessionKey));
    await get().loadHistory(true);
  }

  const sessionKey = targetSessionKey;
  const engineType = resolveEngineTypeForSession(
    get().sessions,
    sessionKey,
    targetAgentId ?? get().currentAgentId,
    {
      messageCount: get().currentSessionKey === sessionKey ? get().messages.length : undefined,
    },
  );
  const session = get().sessions.find((item) => item.key === sessionKey);
  if (engineType && session?.engineType !== engineType) {
    set((state) => ({
      sessions: state.sessions.map((item) => (
        item.key === sessionKey ? { ...item, engineType } : item
      )),
    }));
  }
  const dingTalkRpcExtras = buildDingTalkMentionRpcExtras(
    dingTalkMentions,
    attachments?.map((file) => ({
      fileName: file.fileName,
      filePath: file.stagedPath,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
    })),
  ) ?? {};

  return {
    sessionKey,
    engineType,
    dingTalkRpcExtras,
  };
}
