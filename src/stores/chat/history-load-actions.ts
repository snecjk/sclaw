import { toast } from 'sonner';
import { useGatewayStore } from '../gateway';
import { useSessionUnreadStore } from '@/stores/session-unread';
import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_LENGTH_MAX_LIMIT } from '../../../shared/chat-config';
import {
  isCronDatedSessionKey,
  isCronSessionKey,
  isVirtualTaskSessionKey,
  isClaudeScheduledTaskDatedSessionKey,
  isClaudeScheduledTaskRunSessionKey,
  isClaudeScheduledTaskSessionKey,
} from './cron-session-utils';
import {
  loadClaudeScheduledTaskFallbackMessages,
  loadCronFallbackMessages,
  loadVirtualTaskFallbackMessages,
} from './virtual-task-history';
import {
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  getMessageText,
  isToolResultRole,
} from './helpers';
import { mergeLocalWorkflowTurnsFromCurrent, mergeWorkflowTurnsFromMemory } from '@/lib/workflow-local-turn';
import { ensureWorkflowCardsInMessages, mergeWorkflowCardBlocksFromCurrent } from '@/lib/workflow-card-injection';
import { buildWorkflowCardStatesForSession } from '@/stores/workflow-memory';
import { hydrateSessionWorkflowCards } from '@/lib/workflow-run-hydration';
import { upgradeWorkflowParamUserMessages } from '@/lib/workflow-param-messages';
import {
  absorbWorkflowSchemaFromToolResults,
  ensureWorkflowParameterFormInjected,
  mergeParameterFormBlocksFromCurrent,
  patchLastAssistantWithWorkflowForm,
  isWorkflowFormInjectionAllowed,
  reconcilePendingWorkflowForSession,
  recoverParameterFormsOnHistoryLoad,
} from './parameter-form-recovery';
import { absorbWorkflowExecutionStartedFromToolResults } from '@/lib/builtin-tool-dispatch';
import { deriveSessionLabelFromHistory, isCorruptedSessionLabel, normalizeDerivedSessionLabel } from '@/lib/workflow-session-hint';
import { buildSessionLabelDerivationOptions, shouldAutoDeriveSessionLabel } from '@/lib/session-label';
import {
  dedupeRedundantUserMessages,
  ensureOpeningUserMessageFirst,
  isSameUserMessage,
  mergeOptimisticUserIntoHistory,
  normalizeUserMessageText,
  recoverInitialUserFromSessionLabel,
  traceLoadHistoryUserReconciliation,
} from './user-message-merge';
import { mergeHistoryMessageSources, mergeHistoryWhenShrunk } from './history-merge';
import { shouldAutoCompleteClaudeFromHistory } from './run-completion';
import { getSessionRuntimeState, patchSessionRuntimeState } from './session-runtime';
import { loadMissingPreviews } from './media-preview-cache';
import { hasAssistantTextOutput } from './message-content';
import { getAgentIdFromSessionKey } from './session-identity';
import type { ChatGet, ChatSet, HistoryActions } from './store-api';
import type { ChatSession, RawMessage } from './types';

const HISTORY_LOAD_MIN_INTERVAL_MS = 800;
const _historyLoadInFlight = new Map<string, Promise<void>>();
const _lastHistoryLoadAtBySession = new Map<string, number>();

export interface HistoryLoadDeps {
  toMs: (ts: unknown) => number;
  clearHistoryPoll: () => void;
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
  ) => ChatSession['engineType'] | undefined;
  stripAgentMemoryFromHistoryMessage: (message: RawMessage) => RawMessage;
  dispatchAgentMemoryCapture: (input: {
    agentId?: string | null;
    runId?: string | null;
    sessionKey?: string | null;
    engineType?: ChatSession['engineType'];
  }) => void;
}

export function createHistoryLoadActions(
  set: ChatSet,
  get: ChatGet,
  deps: HistoryLoadDeps,
): HistoryActions {
  const {
    toMs,
    clearHistoryPoll,
    resolveEngineTypeForSession,
    stripAgentMemoryFromHistoryMessage,
    dispatchAgentMemoryCapture,
  } = deps;

  return {
    // ── Load chat history ──

    loadHistory: async (quiet = false, force = false) => {
      const targetSessionKey = get().currentSessionKey;
      const existingLoad = _historyLoadInFlight.get(targetSessionKey);
      if (existingLoad) {
        await existingLoad;
        if (get().currentSessionKey !== targetSessionKey) {
          return get().loadHistory(quiet, force);
        }
        return;
      }

      const lastLoadAt = _lastHistoryLoadAtBySession.get(targetSessionKey) || 0;
      if (quiet && !force && Date.now() - lastLoadAt < HISTORY_LOAD_MIN_INTERVAL_MS) {
        return;
      }

      if (!quiet) set({ loading: true, error: null });

      // 安全保护：如果历史记录加载花费太多时间，则强制将 loading 设置为 false
      // 防止 UI 永远卡在转圈状态。
      let loadingTimedOut = false;
      const loadingSafetyTimer = quiet ? null : setTimeout(() => {
        loadingTimedOut = true;
        set({ loading: false });
      }, 15_000);

      const loadPromise = (async () => {
        const applyLoadedMessages = (
          rawMessages: RawMessage[],
          thinkingLevel: string | null,
          runtimeState?: { isRunning?: boolean; runtimeResult?: unknown },
        ) => {
        if (get().currentSessionKey !== targetSessionKey) return;

        rawMessages = mergeHistoryWhenShrunk(rawMessages, get().messages);

        absorbWorkflowSchemaFromToolResults(rawMessages, targetSessionKey);

        // Before filtering: attach images/files from tool_result messages to the next assistant message
        const messagesWithToolImages = enrichWithToolResultFiles(rawMessages);
        const filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role));
        // Restore file attachments for user/assistant messages (from cache + text patterns)
        const enrichedMessages = enrichWithCachedImages(filteredMessages);

        // Preserve the optimistic user message during an active send.
        // The Gateway may not include the user's message in chat.history
        // until the run completes, causing it to flash out of the UI.
        let finalMessages = enrichedMessages;
        const userMsgAt = get().lastUserMessageAt;
        const historyUserCountBefore = enrichedMessages.filter((m) => m.role === 'user').length;
        const historyMessageCountBefore = enrichedMessages.length;
        const cachedOptimistic = getSessionRuntimeState(
          get().runtimeBySessionKey,
          targetSessionKey,
        ).optimisticUserMessage ?? get().optimisticUserMessage;
        finalMessages = mergeOptimisticUserIntoHistory(enrichedMessages, get().messages, {
          userMessageAt: userMsgAt,
          sending: get().sending,
          sessionKey: targetSessionKey,
          cachedOptimistic,
        });
        const optimisticRefAt = userMsgAt
          ?? (cachedOptimistic?.timestamp ? toMs(cachedOptimistic.timestamp) : 0);
        if (cachedOptimistic && optimisticRefAt > 0
          && finalMessages.some((m) => isSameUserMessage(m, cachedOptimistic, optimisticRefAt))) {
          set((s) => patchSessionRuntimeState(s, targetSessionKey, { optimisticUserMessage: null }));
        } else if (cachedOptimistic) {
          const cachedNorm = normalizeUserMessageText(cachedOptimistic.content);
          if (
            cachedNorm.length > 0
            && finalMessages.some((m) => (
              m.role === 'user'
              && normalizeUserMessageText(m.content) === cachedNorm
            ))
          ) {
            set((s) => patchSessionRuntimeState(s, targetSessionKey, { optimisticUserMessage: null }));
          }
        }

        if (get().currentSessionKey !== targetSessionKey) return;

        reconcilePendingWorkflowForSession(enrichedMessages, rawMessages, targetSessionKey, getMessageText);

        finalMessages = mergeParameterFormBlocksFromCurrent(
          finalMessages,
          get().messages,
          getMessageText,
        );
        finalMessages = mergeLocalWorkflowTurnsFromCurrent(finalMessages, get().messages);
        finalMessages = mergeWorkflowCardBlocksFromCurrent(finalMessages, get().messages);
        finalMessages = mergeWorkflowTurnsFromMemory(finalMessages, targetSessionKey);
        finalMessages = ensureWorkflowCardsInMessages(finalMessages, targetSessionKey, getMessageText);
        const gatewaySessionLabel = get().sessions.find((session) => session.key === targetSessionKey)?.label;
        finalMessages = recoverInitialUserFromSessionLabel(
          finalMessages,
          targetSessionKey,
          get().sessionLabels,
          gatewaySessionLabel,
        );
        finalMessages = ensureOpeningUserMessageFirst(
          finalMessages,
          targetSessionKey,
          get().sessionLabels,
          gatewaySessionLabel,
        );
        finalMessages = dedupeRedundantUserMessages(finalMessages, userMsgAt ?? null, {
          sessionKey: targetSessionKey,
        });
        traceLoadHistoryUserReconciliation({
          sessionKey: targetSessionKey,
          userMessageAt: userMsgAt,
          sending: get().sending,
          beforeCount: historyMessageCountBefore,
          afterCount: finalMessages.length,
          userCountBefore: historyUserCountBefore,
          userCountAfter: finalMessages.filter((m) => m.role === 'user').length,
        });
        const restoredCardStates = buildWorkflowCardStatesForSession(targetSessionKey);
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
            { rawMessages },
          );
          set({
            messages: deferredPatched,
            thinkingLevel,
            loading: false,
            workflowCardStates: restoredCardStates,
          });
          ensureWorkflowParameterFormInjected();
          void (async () => {
            const localized = await upgradeWorkflowParamUserMessages(deferredPatched, targetSessionKey);
            if (get().currentSessionKey !== targetSessionKey) return;
            const msgs = localized !== deferredPatched ? localized : deferredPatched;
            const patched = patchLastAssistantWithWorkflowForm(msgs, getMessageText, { rawMessages });
            if (patched !== msgs) set({ messages: patched });
            await hydrateSessionWorkflowCards(patched !== msgs ? patched : msgs, {
              sessionKey: targetSessionKey,
              agentId: get().currentAgentId,
            });
          })();
          return;
        }
        finalMessages = formRecovery.messages;
        finalMessages = patchLastAssistantWithWorkflowForm(finalMessages, getMessageText, { rawMessages });
        finalMessages = finalMessages.map(stripAgentMemoryFromHistoryMessage);

        set({
          messages: finalMessages,
          thinkingLevel,
          loading: false,
          workflowCardStates: restoredCardStates,
        });

        ensureWorkflowParameterFormInjected();

        void (async () => {
          const localized = await upgradeWorkflowParamUserMessages(finalMessages, targetSessionKey);
          if (get().currentSessionKey !== targetSessionKey) return;
          if (localized !== finalMessages) {
            set({ messages: localized });
            finalMessages = localized;
          }
          await hydrateSessionWorkflowCards(finalMessages, {
            sessionKey: targetSessionKey,
            agentId: get().currentAgentId,
          });
        })();

        // Restore in-memory pending workflow from local draft (survives page refresh).
        if (!get().pendingWorkflow) {
          void import('@/stores/workflow-memory').then(({ getPendingWorkflowDraft, sessionHasWorkflowExecution, clearPendingWorkflowDraft }) => {
            const draft = getPendingWorkflowDraft(targetSessionKey);
            if (!draft) return;
            if (sessionHasWorkflowExecution(targetSessionKey, draft.templateId)) {
              clearPendingWorkflowDraft(targetSessionKey, draft.templateId);
              return;
            }
            void import('@/lib/workflow-api').then(({ getStartupSchema }) => {
              getStartupSchema(draft.templateId).then((startup) => {
                if (get().currentSessionKey !== targetSessionKey) return;
                const msgs = get().messages;
                if (
                  !isWorkflowFormInjectionAllowed(
                    draft.templateId,
                    msgs,
                    getMessageText,
                    targetSessionKey,
                    { rawMessages },
                  )
                ) {
                  clearPendingWorkflowDraft(targetSessionKey, draft.templateId);
                  return;
                }
                get().setPendingWorkflow({
                  templateId: draft.templateId,
                  templateName: draft.templateName,
                  schema: startup.schema,
                  schemaHash: startup.schemaHash,
                  collectedInputs: draft.collectedInputs ?? {},
                  modelGuidanceSent: draft.modelGuidanceSent,
                });
                const patched = patchLastAssistantWithWorkflowForm(msgs, getMessageText, {
                  rawMessages,
                });
                if (patched !== msgs) {
                  set({ messages: patched });
                }
              }).catch(() => {});
            });
          });
        }

        // Extract first user message text as a session label for display in the toolbar.
        // Only set when there is no existing label so manual renames are preserved.
        // Skip main sessions (key ends with ":main") — they rely on the Gateway-provided
        // displayName (e.g. the configured agent name "StoClaw") instead.
        const isMainSession = targetSessionKey.endsWith(':main');
        if (!isMainSession) {
          if (shouldAutoDeriveSessionLabel(targetSessionKey, get().sessionLabels, isCorruptedSessionLabel)) {
            const labelText = deriveSessionLabelFromHistory(
              finalMessages,
              getMessageText,
              buildSessionLabelDerivationOptions(
                targetSessionKey,
                get().sessions,
                get().sessionLabels,
              ),
            );
            if (labelText) {
              const normalized = normalizeDerivedSessionLabel(labelText);
              if (normalized) {
                set((s) => ({
                  sessionLabels: {
                    ...s.sessionLabels,
                    [targetSessionKey]: normalized,
                  },
                }));
              }
            }
          }
        }

        // Record last activity time from the last message in history
        const lastMsg = finalMessages[finalMessages.length - 1];
        if (lastMsg?.timestamp) {
          const lastAt = toMs(lastMsg.timestamp);
          if (lastAt > 0) {
            set((s) => {
              const targetSession = s.sessions.find((session) => session.key === targetSessionKey);
              const listedAt = targetSession?.engineType === 'claude'
                ? 0
                : targetSession?.updatedAt ?? 0;
              const currentAt = s.sessionLastActivity[targetSessionKey] ?? 0;
              const nextAt = Math.max(currentAt, listedAt, lastAt);
              if (nextAt === currentAt) return {};
              return {
                sessionLastActivity: { ...s.sessionLastActivity, [targetSessionKey]: nextAt },
              };
            });
          }
        }

        // Async: load missing image previews from disk (updates in background)
        loadMissingPreviews(finalMessages).then((updated) => {
          if (get().currentSessionKey !== targetSessionKey) return;
          if (updated) {
            // Create new object references so React.memo detects changes.
            // loadMissingPreviews mutates AttachedFileMeta in place, so we
            // must produce fresh message + file references for each affected msg.
            set({
              messages: finalMessages.map(msg =>
                msg._attachedFiles
                  ? { ...msg, _attachedFiles: msg._attachedFiles.map(f => ({ ...f })) }
                  : msg
              ),
            });
          }
        });
        if (get().currentSessionKey !== targetSessionKey) return;

        const { pendingFinal, lastUserMessageAt, sending: isSendingNow } = get();
        const activeEngineType = resolveEngineTypeForSession(
          get().sessions,
          targetSessionKey,
          get().currentAgentId,
        );

        // If we're sending but haven't received streaming events, check
        // whether the loaded history reveals intermediate tool-call activity.
        // This surfaces progress via the pendingFinal → ActivityIndicator path.
        const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
        const isAfterUserMsg = (msg: RawMessage): boolean => {
          if (!userMsTs || !msg.timestamp) return true;
          return toMs(msg.timestamp) >= userMsTs;
        };

        const hasRecentAssistantActivity = isSendingNow && [...filteredMessages].reverse().some((msg) => {
          if (msg.role !== 'assistant') return false;
          return isAfterUserMsg(msg);
        });
        const recentAssistant = [...filteredMessages].reverse().find((msg) => {
          if (msg.role !== 'assistant') return false;
          // Use hasAssistantTextOutput (not hasNonToolAssistantContent) so that
          // intermediate thinking+tool_use turns don't prematurely end the run.
          if (!hasAssistantTextOutput(msg)) return false;
          return isAfterUserMsg(msg);
        });
        const currentRecentAssistant = [...get().messages].reverse().find((msg) => {
          if (msg.role !== 'assistant') return false;
          if (!hasAssistantTextOutput(msg)) return false;
          return isAfterUserMsg(msg);
        });

        if (get().currentSessionKey !== targetSessionKey) return;

        const claudeRuntimeDone = shouldAutoCompleteClaudeFromHistory(
          activeEngineType,
          runtimeState,
          Boolean(recentAssistant || currentRecentAssistant),
        );

        // Agentic runs write intermediate assistant text between tool rounds.
        // Only complete from history when Claude runtime reports done.
        const shouldAutoCompleteFromHistory = claudeRuntimeDone;

        if (shouldAutoCompleteFromHistory) {
          clearHistoryPoll();
          useSessionUnreadStore.getState().markSessionRead(targetSessionKey);
          // This history-poll path completes Claude runs whose gateway
          // agent.completed event was missed, so the
          // finalizeOpenClawRunAfterAgentCompleted dispatch never fires for them.
          // Capture the run id before clearing runtime state and precipitate here.
          const completionRunId = getSessionRuntimeState(get().runtimeBySessionKey, targetSessionKey).activeRunId ?? undefined;
          set((s) => patchSessionRuntimeState(s, targetSessionKey, {
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            lastUserMessageAt: null,
            optimisticUserMessage: null,
            streamingText: '',
            streamingMessage: null,
            streamingMessages: [],
            streamingToolResults: [],
            streamingTools: [],
            pendingToolImages: [],
            error: null,
          }));
          dispatchAgentMemoryCapture({
            agentId: getAgentIdFromSessionKey(targetSessionKey),
            runId: completionRunId,
            sessionKey: targetSessionKey,
            engineType: activeEngineType,
          });
        } else if (hasRecentAssistantActivity && !pendingFinal && isSendingNow) {
          set((s) => patchSessionRuntimeState(s, targetSessionKey, { pendingFinal: true }));
        }
        };

        try {
          // Gateway chat.history does not support offset; load up to the hard max in one call.
          let thinkingLevel: string | null = null;
          const data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
            'chat.history',
            {
              sessionKey: targetSessionKey,
              limit: CHAT_HISTORY_LENGTH_MAX_LIMIT,
              engineType: resolveEngineTypeForSession(get().sessions, targetSessionKey, get().currentAgentId),
            },
          );
          if (get().currentSessionKey !== targetSessionKey) return;

          const allMessages: RawMessage[] = Array.isArray(data.messages)
            ? data.messages as RawMessage[]
            : [];
          if (data.thinkingLevel) {
            thinkingLevel = String(data.thinkingLevel);
          }

          if (allMessages.length >= CHAT_HISTORY_LENGTH_MAX_LIMIT) {
            toast.info('会话消息已达上限', {
              description: '当前会话历史记录较多，建议开启新会话以获得更好的体验。',
              duration: 5000,
            });
          }

          let rawMessages = allMessages;
          if (isVirtualTaskSessionKey(targetSessionKey)) {
            const fallbackMessages = await loadVirtualTaskFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
            rawMessages = fallbackMessages.length > 0
              ? mergeHistoryMessageSources([fallbackMessages, allMessages])
              : allMessages;
          } else if (rawMessages.length === 0 && (isCronSessionKey(targetSessionKey) || isCronDatedSessionKey(targetSessionKey))) {
            rawMessages = await loadCronFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
          } else if (rawMessages.length === 0 && (isClaudeScheduledTaskSessionKey(targetSessionKey) || isClaudeScheduledTaskRunSessionKey(targetSessionKey) || isClaudeScheduledTaskDatedSessionKey(targetSessionKey))) {
            rawMessages = await loadClaudeScheduledTaskFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
          }

          if (get().currentSessionKey !== targetSessionKey) return;
          await absorbWorkflowExecutionStartedFromToolResults(rawMessages, {
            sessionKey: targetSessionKey,
            agentId: get().currentAgentId,
          });
          if (get().currentSessionKey !== targetSessionKey) return;
          applyLoadedMessages(rawMessages, thinkingLevel, {
            isRunning: typeof data.isRunning === 'boolean' ? data.isRunning : undefined,
            runtimeResult: data.runtimeResult,
          });
        } catch (err) {
          console.warn('Failed to load chat history:', err);
          if (get().currentSessionKey !== targetSessionKey) return;
          let fallbackMessages: RawMessage[] = [];
          if (isVirtualTaskSessionKey(targetSessionKey)) {
            fallbackMessages = await loadVirtualTaskFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
          } else if (isCronSessionKey(targetSessionKey) || isCronDatedSessionKey(targetSessionKey)) {
            fallbackMessages = await loadCronFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
          } else if (isClaudeScheduledTaskSessionKey(targetSessionKey) || isClaudeScheduledTaskRunSessionKey(targetSessionKey) || isClaudeScheduledTaskDatedSessionKey(targetSessionKey)) {
            fallbackMessages = await loadClaudeScheduledTaskFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
          }
          if (get().currentSessionKey !== targetSessionKey) return;
          if (fallbackMessages.length > 0) {
            await absorbWorkflowExecutionStartedFromToolResults(fallbackMessages, {
              sessionKey: targetSessionKey,
              agentId: get().currentAgentId,
            });
            if (get().currentSessionKey !== targetSessionKey) return;
            applyLoadedMessages(fallbackMessages, null);
          } else if (get().currentSessionKey === targetSessionKey) {
            set({ messages: [], loading: false });
          }
        }
      })();

      _historyLoadInFlight.set(targetSessionKey, loadPromise);
      try {
        await loadPromise;
      } finally {
        // 正常完成时清除安全定时器
        if (loadingSafetyTimer) clearTimeout(loadingSafetyTimer);
        if (!loadingTimedOut) {
          // Only update load time if we actually didn't time out
          _lastHistoryLoadAtBySession.set(targetSessionKey, Date.now());
        }

        const active = _historyLoadInFlight.get(targetSessionKey);
        if (active === loadPromise) {
          _historyLoadInFlight.delete(targetSessionKey);
        }
      }
    },

  };
}
