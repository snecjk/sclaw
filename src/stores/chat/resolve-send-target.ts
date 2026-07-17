import { buildDingTalkMentionRpcExtras } from '@/lib/dingtalk-mention-context';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession, SendMessageOptions } from './types';
import { getAgentIdFromSessionKey } from './session-identity';

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

export async function resolveSendTarget(input: {
  get: ChatGet;
  set: ChatSet;
  targetAgentId?: string | null;
  requestedSessionKey?: string | null;
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
    requestedSessionKey,
    set,
    targetAgentId,
  } = input;

  const initialState = get();
  const currentSessionKey = initialState.currentSessionKey;
  const explicitSessionKey = requestedSessionKey?.trim() || null;
  const selectedAgentId = normalizeAgentId(targetAgentId);
  const currentSessionAgentId = normalizeAgentId(
    getAgentIdFromSessionKey(currentSessionKey) ?? initialState.currentAgentId,
  );
  // The composer always supplies its selected agent. When it is already the owner
  // of a newly-created dialog, keep that dialog's unique key; otherwise every first
  // send is silently redirected to agent:<id>:main and resumes unrelated history.
  const shouldKeepCurrentSession = !selectedAgentId || selectedAgentId === currentSessionAgentId;
  const targetSessionKey = explicitSessionKey ?? (shouldKeepCurrentSession
    ? currentSessionKey
    : (resolveMainSessionKeyForAgent(targetAgentId) ?? currentSessionKey));
  // Explicit background destinations must not navigate the visible conversation.
  if (!explicitSessionKey && targetSessionKey !== get().currentSessionKey) {
    set((state) => buildSessionSwitchPatch(state, targetSessionKey));
    await get().loadHistory(true);
  }

  const sessionKey = targetSessionKey;
  const engineType = resolveEngineTypeForSession(
    get().sessions,
    sessionKey,
    targetAgentId ?? getAgentIdFromSessionKey(sessionKey) ?? get().currentAgentId,
    {
      messageCount: get().currentSessionKey === sessionKey ? (get().messages?.length ?? 0) : undefined,
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
