import {
  ensureWorkflowParameterFormInjected,
  reconcilePendingWorkflowForSession,
  recoverParameterFormsOnHistoryLoad,
} from './parameter-form-recovery';
import { getMessageText } from './helpers';
import {
  dropSyntheticSkillSessionLabelUsers,
  findHistoryUserEcho,
  isSameUserMessage,
  normalizeUserMessageText,
  traceLoadHistoryUserReconciliation,
} from './user-message-merge';
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
import { logChatFlow, logUserQuestion, logUserQuestionServerEcho } from './chat-flow-log';
import {
  estimateJsonBytes,
  formatPayloadSize,
  markHistoryApplyPerf,
  startHistoryApplyPerf,
} from './history-load-perf';
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

function findOptimisticUserEcho(input: {
  finalMessages: RawMessage[];
  cachedOptimistic: RawMessage;
  userMsgAt: number | null;
  toMs: (ts: unknown) => number;
}): RawMessage | undefined {
  const { finalMessages, cachedOptimistic, userMsgAt, toMs } = input;
  const optimisticRefAt = userMsgAt
    ?? (cachedOptimistic.timestamp ? toMs(cachedOptimistic.timestamp) : 0);

  const byPairing = findHistoryUserEcho(finalMessages, cachedOptimistic, optimisticRefAt);
  if (byPairing) return byPairing;

  if (optimisticRefAt > 0) {
    return finalMessages.find((message) => (
      isSameUserMessage(message, cachedOptimistic, optimisticRefAt)
    ));
  }

  const cachedNorm = normalizeUserMessageText(cachedOptimistic.content);
  if (!cachedNorm) return undefined;
  return finalMessages.find((message) => (
    message.role === 'user'
    && normalizeUserMessageText(message.content) === cachedNorm
  ));
}

export function hasOptimisticUserEcho(input: {
  finalMessages: RawMessage[];
  cachedOptimistic: RawMessage | null;
  userMsgAt: number | null;
  toMs: (ts: unknown) => number;
}): boolean {
  const { cachedOptimistic } = input;
  if (!cachedOptimistic) return false;
  return Boolean(findOptimisticUserEcho({ ...input, cachedOptimistic }));
}

/** 记录发送后往返的 Gateway/history 用户轮次（模型实际看到的内容）。 */
function logModelReturnedUserQuestion(input: {
  sessionKey: string;
  historyMessages: RawMessage[];
  previousTranscript: RawMessage[];
  optimistic: RawMessage | null;
  userMsgAt: number | null;
  sending: boolean;
  toMs: (ts: unknown) => number;
}): void {
  const {
    sessionKey,
    historyMessages,
    previousTranscript,
    optimistic,
    userMsgAt,
    sending,
    toMs,
  } = input;

  if (optimistic) {
    const historyEcho = findOptimisticUserEcho({
      finalMessages: historyMessages,
      cachedOptimistic: optimistic,
      userMsgAt,
      toMs,
    });
    if (historyEcho) {
      logUserQuestionServerEcho({
        sessionKey,
        matchReason: optimistic.id && historyEcho.id && optimistic.id === historyEcho.id
          ? 'id-match'
          : 'display-or-time-match',
        optimisticId: optimistic.id ?? null,
        historyUserId: historyEcho.id ?? null,
        optimisticContent: getMessageText(optimistic.content),
        historyContent: getMessageText(historyEcho.content),
        optimisticSkillMetas: optimistic._skillMetas
          ?? (optimistic._skillMeta ? [optimistic._skillMeta] : undefined),
        historySkillMetas: historyEcho._skillMetas
          ?? (historyEcho._skillMeta ? [historyEcho._skillMeta] : undefined),
        optimisticSegments: optimistic._composerSegments,
        historySegments: historyEcho._composerSegments,
        optimisticAttachments: optimistic._attachedFiles,
        historyAttachments: historyEcho._attachedFiles,
      });
      return;
    }

    if (!sending) return;

    const lastUser = [...historyMessages].reverse().find((message) => message.role === 'user');
    if (!lastUser) return;
    const alreadyKnown = previousTranscript.some((message) => (
      message.role === 'user'
      && (
        (lastUser.id && message.id && lastUser.id === message.id)
        || normalizeUserMessageText(message.content) === normalizeUserMessageText(lastUser.content)
      )
    ));
    if (alreadyKnown) return;

    logUserQuestion('history-user-unmatched', {
      sessionKey,
      optimisticId: optimistic.id ?? null,
      historyUserId: lastUser.id ?? null,
      optimisticContent: getMessageText(optimistic.content),
      historyContent: getMessageText(lastUser.content),
      optimisticAttachments: optimistic._attachedFiles,
      historyAttachments: lastUser._attachedFiles,
    });
    return;
  }

  if (!sending) return;

  const lastUser = [...historyMessages].reverse().find((message) => message.role === 'user');
  if (!lastUser) return;
  const alreadyKnown = previousTranscript.some((message) => (
    message.role === 'user'
    && (
      (lastUser.id && message.id && lastUser.id === message.id)
      || normalizeUserMessageText(message.content) === normalizeUserMessageText(lastUser.content)
    )
  ));
  if (alreadyKnown) return;

  logUserQuestion('history-user', {
    sessionKey,
    historyUserId: lastUser.id ?? null,
    historyContent: getMessageText(lastUser.content),
    historyAttachments: lastUser._attachedFiles,
  });
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
  startHistoryApplyPerf(targetSessionKey);
  logChatFlow('history.apply.start', {
    sessionKey: targetSessionKey,
    rawCount: rawMessages.length,
    payloadBytes: estimateJsonBytes(rawMessages),
    payloadSize: formatPayloadSize(estimateJsonBytes(rawMessages)),
  });

  const prepareStartedAt = performance.now();
  const canonicalBeforeLoad = useChatRuntimeV2Store.getState().sessionsByKey[targetSessionKey];
  // 在 setTranscript 之前先捕获——id 匹配回显可能在 setTranscript 内清掉乐观消息。
  const optimisticBeforeLoad = canonicalBeforeLoad?.overlay.optimisticUserMessage ?? null;
  const previousTranscript = canonicalBeforeLoad?.transcript ?? [];
  const sendingBeforeLoad = buildChatSessionRuntimeView(canonicalBeforeLoad).sending;

  const preparedHistory = prepareHistoryMessages({
    rawMessages,
    previousTranscript,
    sessionKey: targetSessionKey,
  });
  markHistoryApplyPerf(targetSessionKey, 'apply.prepare.done', {
    prepareMs: Math.round(performance.now() - prepareStartedAt),
    rawCount: rawMessages.length,
    enrichedCount: preparedHistory.enrichedMessages.length,
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
  const cachedOptimistic = optimisticBeforeLoad
    ?? canonicalSession?.overlay.optimisticUserMessage
    ?? null;

  logModelReturnedUserQuestion({
    sessionKey: targetSessionKey,
    // 优先用引擎原始载荷——这是 Gateway/模型实际落库的用户轮次。
    historyMessages: preparedRawMessages,
    previousTranscript,
    optimistic: optimisticBeforeLoad,
    userMsgAt: userMsgAt ?? null,
    sending: sendingBeforeLoad || runtimeView.sending,
    toMs,
  });

  let finalMessages = enrichedMessages;

  if (get().currentSessionKey !== targetSessionKey) return;

  reconcilePendingWorkflowForSession(enrichedMessages, preparedRawMessages, targetSessionKey, getMessageText);

  const gatewaySessionLabel = get().sessions.find((session) => session.key === targetSessionKey)?.label;
  const mergeStartedAt = performance.now();
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
    cachedOptimistic,
  });
  markHistoryApplyPerf(targetSessionKey, 'apply.merge.done', {
    mergeMs: Math.round(performance.now() - mergeStartedAt),
    messageCount: finalMessages.length,
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
  const formRecoveryStartedAt = performance.now();
  const formRecovery = recoverParameterFormsOnHistoryLoad(finalMessages, {
    sessionKey: targetSessionKey,
    get,
    set,
    getMessageText,
    thinkingLevel,
  });
  markHistoryApplyPerf(targetSessionKey, 'apply.recover.done', {
    recoverMs: Math.round(performance.now() - formRecoveryStartedAt),
    deferSet: formRecovery.deferSet,
    messageCount: formRecovery.messages.length,
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
  const displayPayloadBytes = estimateJsonBytes(finalMessages);
  logChatFlow('history.apply.committed', {
    sessionKey: targetSessionKey,
    messageCount: finalMessages.length,
    thinkingLevel,
    displayPayloadBytes,
    displayPayloadSize: formatPayloadSize(displayPayloadBytes),
  });
  markHistoryApplyPerf(targetSessionKey, 'apply.committed', {
    messageCount: finalMessages.length,
    displayPayloadBytes,
    displayPayloadSize: formatPayloadSize(displayPayloadBytes),
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
