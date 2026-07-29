import { useSessionUnreadStore } from '@/stores/session-unread';
import { analyzeRecentAssistantActivity } from './history-pipeline';
import { hasAssistantTextOutput } from './message-content';
import { applyRuntimePatch } from './runtime-controller';
import { getAgentIdFromSessionKey } from './session-identity';
import { getSessionRuntimeState } from './session-runtime';
import { buildTerminalRuntimePatch, shouldAutoCompleteTurnFromHistory } from './turn-state-machine';
import { buildTerminalTurnEffects, executeTurnEffects } from './turn-effects';
import { logChatFlow } from './chat-flow-log';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession, RawMessage } from './types';

export function shouldAutoCompleteOpenClawFromHistory(input: {
  isSending: boolean;
  pendingFinal: boolean;
  hasRecentAssistantOutput: boolean;
  hasRunningTool: boolean;
  runtimeState?: { isRunning?: boolean };
}): boolean {
  const {
    hasRecentAssistantOutput,
    hasRunningTool,
    isSending,
    pendingFinal,
    runtimeState,
  } = input;

  // A history snapshot can contain intermediate assistant narration while the
  // same OpenClaw run is about to start another tool batch. Only an explicit
  // authoritative `isRunning: false` may turn that snapshot into a terminal
  // signal; missing runtime state must keep the active run bound so later
  // deltas are not rejected as orphan events.
  return isSending
    && pendingFinal
    && runtimeState?.isRunning === false
    && hasRecentAssistantOutput
    && !hasRunningTool;
}

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
  // OpenClaw 常不下发 turn.completed；history 只有在明确报告运行已结束时才能收尾。
  // `isRunning` 缺失时，assistant 正文可能只是多步骤任务的阶段性说明。
  const shouldAutoCompleteOpenClaw = activeEngineType === 'openclaw'
    && shouldAutoCompleteOpenClawFromHistory({
      isSending: isSendingNow,
      pendingFinal: pendingFinal || sessionRuntime.pendingFinal,
      runtimeState,
      hasRecentAssistantOutput: recentAssistantActivity.hasRecentAssistantOutput,
      hasRunningTool,
    });

  if (shouldAutoCompleteFromHistory || shouldAutoCompleteOpenClaw) {
    logChatFlow('history.runtime.auto-complete', {
      sessionKey,
      engineType: activeEngineType ?? null,
      activeRunId: sessionRuntime.activeRunId,
      reason: shouldAutoCompleteOpenClaw
        ? 'openclaw-runtime-not-running'
        : 'engine-runtime-complete',
      isRunning: runtimeState?.isRunning ?? null,
      pendingFinal: pendingFinal || sessionRuntime.pendingFinal,
      hasRecentAssistantOutput: recentAssistantActivity.hasRecentAssistantOutput,
      hasRunningTool,
    });
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
