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

  const sessionRuntime = getSessionRuntimeState(get().runtimeBySessionKey, sessionKey);
  const hasRunningTool = sessionRuntime.streamingTools.some((tool) => tool.status === 'running');
  // OpenClaw 常不下发 turn.completed；已 pendingFinal 且 history/本地已有正文、无运行中工具时收尾。
  const shouldAutoCompleteOpenClaw =
    activeEngineType === 'openclaw'
    && isSendingNow
    && (pendingFinal || sessionRuntime.pendingFinal)
    && recentAssistantActivity.hasRecentAssistantOutput
    && !hasRunningTool;

  if (shouldAutoCompleteFromHistory || shouldAutoCompleteOpenClaw) {
    clearHistoryPoll(sessionKey);
    useSessionUnreadStore.getState().markSessionRead(sessionKey);
    const completionRunId = sessionRuntime.activeRunId ?? undefined;
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
