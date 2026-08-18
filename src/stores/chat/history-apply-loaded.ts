import {
  ensureWorkflowParameterFormInjected,
  reconcilePendingWorkflowForSession,
  recoverParameterFormsOnHistoryLoad,
} from './parameter-form-recovery';
import { getMessageText } from './helpers';
import {
  dropSyntheticSkillSessionLabelUsers,
  isSameUserMessage,
  normalizeUserMessageText,
  traceLoadHistoryUserReconciliation,
} from './user-message-merge';
import { isScheduledTaskUserEcho } from './scheduled-task-user-echo';
import {
  mergeHistoryDisplayMessages,
  prepareHistoryMessages,
} from './history-pipeline';
import {
  loadMissingPreviewsInBackground,
  maybeDeriveSessionLabel,
  recordSessionActivityFromMessages,
} from './history-side-effects';
import { restorePendingWorkflowDraftInBackground } from './history-workflow-effects';
import { localizeAndHydrateWorkflowForms } from './history-form-effects';
import { logChatFlow } from './chat-flow-log';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession, RawMessage } from './types';
import { restoreSkillMetaOnMessages } from '@/lib/skill-message-meta-cache';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import { buildChatSessionRuntimeView } from './runtime-selectors';
import { getCurrentChatDisplayMessages } from './display-selectors';

export interface ApplyLoadedHistoryDeps {
  toMs: (ts: unknown) => number;
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
  const { getCurrentSessionKey, sessionKey } = input;
  if (getCurrentSessionKey() !== sessionKey) return false;
  return getCurrentSessionKey() === sessionKey;
}

export function hasOptimisticUserEcho(input: {
  finalMessages: RawMessage[];
  cachedOptimistic: RawMessage | null;
  userMsgAt: number | null;
  toMs: (ts: unknown) => number;
}): boolean {
  const { finalMessages, cachedOptimistic, userMsgAt, toMs } = input;
  if (!cachedOptimistic) return false;

  const optimisticRefAt = userMsgAt
    ?? (cachedOptimistic.timestamp ? toMs(cachedOptimistic.timestamp) : 0);
  if (!cachedOptimistic._scheduledTaskOptimistic) {
    if (optimisticRefAt > 0) {
      return finalMessages.some((message) => (
        isSameUserMessage(message, cachedOptimistic, optimisticRefAt)
      ));
    }

    const cachedNorm = normalizeUserMessageText(cachedOptimistic.content);
    return (
      cachedNorm.length > 0
      && finalMessages.some((message) => (
        message.role === 'user'
        && normalizeUserMessageText(message.content) === cachedNorm
      ))
    );
  }

  return finalMessages.some((message) => (
    isScheduledTaskUserEcho(message, cachedOptimistic, optimisticRefAt)
  ));
}

function clearOptimisticUserIfEchoed(input: {
  targetSessionKey: string;
  finalMessages: RawMessage[];
  cachedOptimistic: RawMessage | null;
  userMsgAt: number | null;
  toMs: (ts: unknown) => number;
}): void {
  const { targetSessionKey, ...echoInput } = input;
  if (hasOptimisticUserEcho(echoInput)) {
    useChatRuntimeV2Store.getState().setOptimisticUserMessage(targetSessionKey, null);
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
    toMs,
  } = deps;

  if (get().currentSessionKey !== targetSessionKey) return;
  logChatFlow('history.apply.start', {
    sessionKey: targetSessionKey,
    rawCount: rawMessages.length,
    thinkingLevel,
    hasRuntimeState: Boolean(runtimeState),
  });

  const canonicalBeforeLoad = useChatRuntimeV2Store.getState().sessionsByKey[targetSessionKey];
  const preparedHistory = prepareHistoryMessages({
    rawMessages,
    previousTranscript: canonicalBeforeLoad?.transcript ?? [],
    sessionKey: targetSessionKey,
  });
  const preparedRawMessages = preparedHistory.rawMessages;
  // Canonical transcript keeps the engine payload untouched. Legacy display
  // enrichment below may merge cached/decorated messages, but never writes
  // those decorations back into RawTranscript.
  useChatRuntimeV2Store.getState().setTranscript(targetSessionKey, preparedRawMessages);
  const enrichedMessages = preparedHistory.enrichedMessages;
  const canonicalSession = useChatRuntimeV2Store.getState().sessionsByKey[targetSessionKey];
  const runtimeView = buildChatSessionRuntimeView(canonicalSession);

  const userMsgAt = runtimeView.lastUserMessageAt;
  const historyUserCountBefore = enrichedMessages.filter((m) => m.role === 'user').length;
  const historyMessageCountBefore = enrichedMessages.length;
  const cachedOptimistic = canonicalSession?.overlay.optimisticUserMessage ?? null;
  let finalMessages = enrichedMessages;

  if (get().currentSessionKey !== targetSessionKey) return;

  reconcilePendingWorkflowForSession(enrichedMessages, preparedRawMessages, targetSessionKey, getMessageText);

  const gatewaySessionLabel = get().sessions.find((session) => session.key === targetSessionKey)?.label;
  finalMessages = mergeHistoryDisplayMessages({
    messages: finalMessages,
    currentMessages: getCurrentChatDisplayMessages(),
    sessionKey: targetSessionKey,
    sessionLabels: get().sessionLabels,
    gatewaySessionLabel,
    userMessageAt: userMsgAt ?? null,
    sending: runtimeView.sending,
    optimisticUser: cachedOptimistic,
    getMessageText,
  });
  finalMessages = restoreSkillMetaOnMessages(
    finalMessages,
    targetSessionKey,
    gatewaySessionLabel,
  );
  // Skill meta is applied after the merge/recover pipeline, so a synthetic
  // session-label opener may have been inserted before the real skill turn was
  // recognizable. Drop it now that the skill turn is tagged. Overlay skill
  // chips count too — otherwise a failed send keeps both the truncated title
  // bubble and the optimistic skill bubble.
  finalMessages = dropSyntheticSkillSessionLabelUsers(finalMessages, {
    hasSkillUser: Boolean(cachedOptimistic?._skillMeta),
  });
  clearOptimisticUserIfEchoed({
    targetSessionKey,
    finalMessages,
    cachedOptimistic,
    userMsgAt,
    toMs,
  });
  traceLoadHistoryUserReconciliation({
    sessionKey: targetSessionKey,
    userMessageAt: userMsgAt,
    sending: runtimeView.sending,
    beforeCount: historyMessageCountBefore,
    afterCount: finalMessages.length,
    userCountBefore: historyUserCountBefore,
    userCountAfter: finalMessages.filter((m) => m.role === 'user').length,
  });
  const formRecovery = recoverParameterFormsOnHistoryLoad(finalMessages, {
    sessionKey: targetSessionKey,
    get,
    set,
    getMessageText,
    thinkingLevel,
  });
  if (formRecovery.deferSet) {
    useChatRuntimeV2Store.getState().setDisplayProjection(targetSessionKey, formRecovery.messages);
    set({
      thinkingLevel,
      loading: false,
    });
    ensureWorkflowParameterFormInjected();
    localizeAndHydrateWorkflowForms({
      get,
      set,
      sessionKey: targetSessionKey,
      messages: formRecovery.messages,
      rawMessages: preparedRawMessages,
      patchWorkflowForm: true,
    });
    return;
  }
  finalMessages = formRecovery.messages;

  useChatRuntimeV2Store.getState().setDisplayProjection(targetSessionKey, finalMessages);
  set({ thinkingLevel, loading: false });
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

  // Runtime completion is authoritative in Main's ChatRuntimeSupervisor.
  // History updates transcript only; it no longer infers terminal run state.
}
