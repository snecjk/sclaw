import { useSessionUnreadStore } from '@/stores/session-unread';
import { analyzeRecentAssistantActivity } from './history-pipeline';
import { hasAssistantTextOutput } from './message-content';
import { applyRuntimePatch } from './runtime-controller';
import { getAgentIdFromSessionKey } from './session-identity';
import { getSessionRuntimeState } from './session-runtime';
import { buildTerminalRuntimePatch, shouldAutoCompleteTurnFromHistory } from './turn-state-machine';
import { buildTerminalTurnEffects, executeTurnEffects } from './turn-effects';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession, RawMessage } from './types';

export function reconcileHistoryRuntimeCompletion(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  filteredMessages: RawMessage[];
  runtimeState?: { isRunning?: boolean; runtimeResult?: unknown };
  activeEngineType?: ChatSession['engineType'];
  toMs: (ts: unknown) => number;
  clearHistoryPoll: (sessionKey: string) => void;
}): void {
  const {
    activeEngineType,
    clearHistoryPoll,
    filteredMessages,
    get,
    runtimeState,
    sessionKey,
    set,
    toMs,
  } = input;

  const { pendingFinal, lastUserMessageAt, sending: isSendingNow } = get();
  const recentAssistantActivity = analyzeRecentAssistantActivity({
    filteredMessages,
    currentMessages: get().messages,
    userMessageAt: lastUserMessageAt,
    sending: isSendingNow,
    toMs,
    hasAssistantTextOutput,
  });

  if (get().currentSessionKey !== sessionKey) return;

  const shouldAutoCompleteFromHistory = shouldAutoCompleteTurnFromHistory({
    engineType: activeEngineType,
    runtimeState,
    hasRecentAssistant: recentAssistantActivity.hasRecentAssistantOutput,
  });

  if (shouldAutoCompleteFromHistory) {
    clearHistoryPoll(sessionKey);
    useSessionUnreadStore.getState().markSessionRead(sessionKey);
    const completionRunId = getSessionRuntimeState(get().runtimeBySessionKey, sessionKey).activeRunId ?? undefined;
    set((state) => applyRuntimePatch(state, sessionKey, buildTerminalRuntimePatch(null)));
    executeTurnEffects(buildTerminalTurnEffects({
      agentId: getAgentIdFromSessionKey(sessionKey),
      runId: completionRunId,
      sessionKey,
      engineType: activeEngineType,
    }), { get, set });
  } else if (recentAssistantActivity.hasRecentAssistantActivity && !pendingFinal && isSendingNow) {
    set((state) => applyRuntimePatch(state, sessionKey, { pendingFinal: true }));
  }
}
