import { buildWorkflowCardStatesForSession } from '@/stores/workflow-memory';
import { mergeWorkflowCardState } from '@/lib/workflow-card-state-merge';
import { absorbWorkflowExecutionStartedFromToolResults } from '@/lib/builtin-tool-dispatch';
import {
  ensureWorkflowParameterFormInjected,
  patchLastAssistantWithWorkflowForm,
  reconcilePendingWorkflowForSession,
  recoverParameterFormsOnHistoryLoad,
} from './parameter-form-recovery';
import { getMessageText } from './helpers';
import {
  dropSyntheticSkillSessionLabelUsers,
  isSameUserMessage,
  mergeOptimisticUserIntoHistory,
  normalizeUserMessageText,
  traceLoadHistoryUserReconciliation,
} from './user-message-merge';
import {
  mergeHistoryDisplayMessages,
  prepareHistoryMessages,
} from './history-pipeline';
import { getSessionRuntimeState } from './session-runtime';
import { applyRuntimePatch } from './runtime-controller';
import {
  loadMissingPreviewsInBackground,
  maybeDeriveSessionLabel,
  recordSessionActivityFromMessages,
} from './history-side-effects';
import { restorePendingWorkflowDraftInBackground } from './history-workflow-effects';
import { localizeAndHydrateWorkflowForms } from './history-form-effects';
import { reconcileHistoryRuntimeCompletion } from './history-runtime-completion';
import { logChatFlow } from './chat-flow-log';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession, RawMessage } from './types';
import { restoreSkillMetaOnMessages } from '@/lib/skill-message-meta-cache';

export interface ApplyLoadedHistoryDeps {
  toMs: (ts: unknown) => number;
  clearHistoryPoll: (sessionKey: string) => void;
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
  ) => ChatSession['engineType'] | undefined;
}

export async function prepareHistoryToolEffects(input: {
  rawMessages: RawMessage[];
  sessionKey: string;
  agentId?: string | null;
  getCurrentSessionKey: () => string;
}): Promise<boolean> {
  const {
    agentId,
    getCurrentSessionKey,
    rawMessages,
    sessionKey,
  } = input;
  if (getCurrentSessionKey() !== sessionKey) return false;
  await absorbWorkflowExecutionStartedFromToolResults(rawMessages, {
    sessionKey,
    agentId: agentId ?? 'main',
  });
  return getCurrentSessionKey() === sessionKey;
}

function clearOptimisticUserIfEchoed(input: {
  set: ChatSet;
  targetSessionKey: string;
  finalMessages: RawMessage[];
  cachedOptimistic: RawMessage | null;
  userMsgAt: number | null;
  toMs: (ts: unknown) => number;
}): void {
  const {
    set,
    targetSessionKey,
    finalMessages,
    cachedOptimistic,
    userMsgAt,
    toMs,
  } = input;
  if (!cachedOptimistic) return;

  const optimisticRefAt = userMsgAt
    ?? (cachedOptimistic.timestamp ? toMs(cachedOptimistic.timestamp) : 0);
  if (
    optimisticRefAt > 0
    && finalMessages.some((m) => isSameUserMessage(m, cachedOptimistic, optimisticRefAt))
  ) {
    set((s) => applyRuntimePatch(s, targetSessionKey, { optimisticUserMessage: null }));
    return;
  }

  const cachedNorm = normalizeUserMessageText(cachedOptimistic.content);
  if (
    cachedNorm.length > 0
    && finalMessages.some((m) => (
      m.role === 'user'
      && normalizeUserMessageText(m.content) === cachedNorm
    ))
  ) {
    set((s) => applyRuntimePatch(s, targetSessionKey, { optimisticUserMessage: null }));
  }
}

export function applyLoadedHistorySnapshot(input: {
  get: ChatGet;
  set: ChatSet;
  deps: ApplyLoadedHistoryDeps;
  targetSessionKey: string;
  rawMessages: RawMessage[];
  thinkingLevel: string | null;
  runtimeState?: { isRunning?: boolean; runtimeResult?: unknown };
}): void {
  const {
    deps,
    get,
    rawMessages,
    runtimeState,
    set,
    targetSessionKey,
    thinkingLevel,
  } = input;
  const {
    clearHistoryPoll,
    resolveEngineTypeForSession,
    toMs,
  } = deps;

  if (get().currentSessionKey !== targetSessionKey) return;
  logChatFlow('history.apply.start', {
    sessionKey: targetSessionKey,
    rawCount: rawMessages.length,
    thinkingLevel,
    hasRuntimeState: Boolean(runtimeState),
  });

  const preparedHistory = prepareHistoryMessages({
    rawMessages,
    currentMessages: get().messages,
    sessionKey: targetSessionKey,
  });
  const preparedRawMessages = preparedHistory.rawMessages;
  const filteredMessages = preparedHistory.filteredMessages;
  const enrichedMessages = preparedHistory.enrichedMessages;

  const userMsgAt = get().lastUserMessageAt;
  const historyUserCountBefore = enrichedMessages.filter((m) => m.role === 'user').length;
  const historyMessageCountBefore = enrichedMessages.length;
  const cachedOptimistic = getSessionRuntimeState(
    get().runtimeBySessionKey,
    targetSessionKey,
  ).optimisticUserMessage ?? get().optimisticUserMessage;
  let finalMessages = mergeOptimisticUserIntoHistory(enrichedMessages, get().messages, {
    userMessageAt: userMsgAt,
    sending: get().sending,
    sessionKey: targetSessionKey,
    cachedOptimistic,
  });
  clearOptimisticUserIfEchoed({
    set,
    targetSessionKey,
    finalMessages,
    cachedOptimistic,
    userMsgAt,
    toMs,
  });

  if (get().currentSessionKey !== targetSessionKey) return;

  reconcilePendingWorkflowForSession(enrichedMessages, preparedRawMessages, targetSessionKey, getMessageText);

  const gatewaySessionLabel = get().sessions.find((session) => session.key === targetSessionKey)?.label;
  finalMessages = mergeHistoryDisplayMessages({
    messages: finalMessages,
    currentMessages: get().messages,
    sessionKey: targetSessionKey,
    sessionLabels: get().sessionLabels,
    gatewaySessionLabel,
    userMessageAt: userMsgAt ?? null,
    sending: get().sending,
    getMessageText,
  });
  finalMessages = restoreSkillMetaOnMessages(
    finalMessages,
    targetSessionKey,
    gatewaySessionLabel,
  );
  // Skill meta is applied after the merge/recover pipeline, so a synthetic
  // session-label opener may have been inserted before the real skill turn was
  // recognizable. Drop it now that the skill turn is tagged.
  finalMessages = dropSyntheticSkillSessionLabelUsers(finalMessages);
  traceLoadHistoryUserReconciliation({
    sessionKey: targetSessionKey,
    userMessageAt: userMsgAt,
    sending: get().sending,
    beforeCount: historyMessageCountBefore,
    afterCount: finalMessages.length,
    userCountBefore: historyUserCountBefore,
    userCountAfter: finalMessages.filter((m) => m.role === 'user').length,
  });
  const restoredCardStates = {
    ...get().workflowCardStates,
    ...buildWorkflowCardStatesForSession(targetSessionKey),
  };
  // History is an eventually-consistent snapshot. Preserve newer IPC/hydration
  // details already rendered for this session instead of replacing them.
  const currentCardStates = get().workflowCardStates;
  for (const [runId, restored] of Object.entries(restoredCardStates)) {
    const current = currentCardStates[runId];
    if (current) restoredCardStates[runId] = mergeWorkflowCardState(current, restored);
  }
  const formRecovery = recoverParameterFormsOnHistoryLoad(finalMessages, {
    sessionKey: targetSessionKey,
    get,
    set,
    getMessageText,
    thinkingLevel,
  });
  if (formRecovery.deferSet) {
    const deferredPatched = patchLastAssistantWithWorkflowForm(
      formRecovery.messages,
      getMessageText,
      { rawMessages: preparedRawMessages },
    );
    set({
      messages: deferredPatched,
      thinkingLevel,
      loading: false,
      workflowCardStates: restoredCardStates,
    });
    ensureWorkflowParameterFormInjected();
    localizeAndHydrateWorkflowForms({
      get,
      set,
      sessionKey: targetSessionKey,
      messages: deferredPatched,
      rawMessages: preparedRawMessages,
      patchWorkflowForm: true,
    });
    return;
  }
  finalMessages = formRecovery.messages;
  finalMessages = patchLastAssistantWithWorkflowForm(finalMessages, getMessageText, { rawMessages: preparedRawMessages });

  set({
    messages: finalMessages,
    thinkingLevel,
    loading: false,
    workflowCardStates: restoredCardStates,
  });
  logChatFlow('history.apply.committed', {
    sessionKey: targetSessionKey,
    messageCount: finalMessages.length,
    thinkingLevel,
  });

  ensureWorkflowParameterFormInjected();

  localizeAndHydrateWorkflowForms({
    get,
    set,
    sessionKey: targetSessionKey,
    messages: finalMessages,
    rawMessages: preparedRawMessages,
    onLocalized: (messages) => {
      finalMessages = messages;
    },
  });

  restorePendingWorkflowDraftInBackground({
    get,
    set,
    sessionKey: targetSessionKey,
    rawMessages: preparedRawMessages,
  });

  maybeDeriveSessionLabel({
    get,
    set,
    sessionKey: targetSessionKey,
    messages: finalMessages,
  });

  recordSessionActivityFromMessages({
    set,
    sessionKey: targetSessionKey,
    messages: finalMessages,
    toMs,
  });

  loadMissingPreviewsInBackground({
    get,
    set,
    sessionKey: targetSessionKey,
    messages: finalMessages,
  });
  if (get().currentSessionKey !== targetSessionKey) return;

  const activeEngineType = resolveEngineTypeForSession(
    get().sessions,
    targetSessionKey,
    get().currentAgentId,
  );

  if (get().currentSessionKey !== targetSessionKey) return;

  reconcileHistoryRuntimeCompletion({
    get,
    set,
    sessionKey: targetSessionKey,
    filteredMessages,
    runtimeState,
    clearHistoryPoll,
    activeEngineType,
    toMs,
  });
}
