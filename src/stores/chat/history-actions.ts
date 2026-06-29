import { toast } from 'sonner';
import { hostApiFetch } from '@/lib/host-api';
import { deriveSessionLabelFromHistory, isCorruptedSessionLabel, truncateSessionLabel } from '@/lib/workflow-session-hint';
import { buildSessionLabelDerivationOptions, shouldAutoDeriveSessionLabel } from '@/lib/session-label';
import { mergeLocalWorkflowTurnsFromCurrent } from '@/lib/workflow-local-turn';
import {
  mergeParameterFormBlocksFromCurrent,
  recoverParameterFormsOnHistoryLoad,
} from './parameter-form-recovery';
import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_LENGTH_MAX_LIMIT } from '../../../shared/chat-config';
import {
  clearHistoryPoll,
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  getMessageText,
  hasNonToolAssistantContent,
  isToolResultRole,
  loadMissingPreviews,
  toMs,
} from './helpers';
import {
  buildClaudeScheduledTaskSessionHistoryPath,
  buildCronSessionHistoryPath,
  buildScheduledTaskSessionHistoryPath,
  isClaudeScheduledTaskSessionKey,
  isCronSessionKey,
  isCronDatedSessionKey,
  isScheduledTaskSessionKey,
} from './cron-session-utils';
import type { RawMessage } from './types';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';
import {
  dedupeRedundantUserMessages,
  mergeOptimisticUserIntoHistory,
  traceLoadHistoryUserReconciliation,
} from './user-message-merge';

async function loadCronFallbackMessages(sessionKey: string, limit = CHAT_HISTORY_LIMIT): Promise<RawMessage[]> {
  if (!isCronSessionKey(sessionKey) && !isCronDatedSessionKey(sessionKey)) return [];
  try {
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      buildCronSessionHistoryPath(sessionKey, limit),
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('Failed to load cron fallback history:', error);
    return [];
  }
}

async function loadScheduledTaskFallbackMessages(sessionKey: string, limit = CHAT_HISTORY_LIMIT): Promise<RawMessage[]> {
  if (!isScheduledTaskSessionKey(sessionKey)) return [];
  try {
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      buildScheduledTaskSessionHistoryPath(sessionKey, limit),
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('Failed to load scheduled task fallback history:', error);
    return [];
  }
}

async function loadClaudeScheduledTaskFallbackMessages(sessionKey: string, limit = CHAT_HISTORY_LIMIT): Promise<RawMessage[]> {
  if (!isClaudeScheduledTaskSessionKey(sessionKey)) return [];
  try {
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      buildClaudeScheduledTaskSessionHistoryPath(sessionKey, limit),
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('Failed to load Claude scheduled task fallback history:', error);
    return [];
  }
}

export function createHistoryActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadHistory'> {
  return {
    loadHistory: async (quiet = false) => {
      
      const { currentSessionKey, sessions } = get();
      const currentSession = sessions.find((session) => session.key === currentSessionKey);
      if (!quiet) set({ loading: true, error: null });

      const applyLoadedMessages = (rawMessages: RawMessage[], thinkingLevel: string | null) => {
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
        if (userMsgAt) {
          finalMessages = mergeOptimisticUserIntoHistory(enrichedMessages, get().messages, {
            userMessageAt: userMsgAt,
            sending: get().sending,
            sessionKey: currentSessionKey,
          });
        }

        finalMessages = mergeParameterFormBlocksFromCurrent(
          finalMessages,
          get().messages,
          getMessageText,
        );
        finalMessages = mergeLocalWorkflowTurnsFromCurrent(finalMessages, get().messages);
        finalMessages = dedupeRedundantUserMessages(finalMessages, userMsgAt ?? null, {
          sessionKey: currentSessionKey,
        });
        traceLoadHistoryUserReconciliation({
          sessionKey: currentSessionKey,
          userMessageAt: userMsgAt,
          sending: get().sending,
          beforeCount: historyMessageCountBefore,
          afterCount: finalMessages.length,
          userCountBefore: historyUserCountBefore,
          userCountAfter: finalMessages.filter((m) => m.role === 'user').length,
        });
        const formRecovery = recoverParameterFormsOnHistoryLoad(finalMessages, {
          sessionKey: currentSessionKey,
          get,
          set,
          getMessageText,
          thinkingLevel,
        });
        if (formRecovery.deferSet) return;
        finalMessages = formRecovery.messages;

        set({ messages: finalMessages, thinkingLevel, loading: false });

        // Extract first user message text as a session label for display in the toolbar.
        // Skip main sessions (key ends with ":main") — they rely on the Gateway-provided
        // displayName (e.g. the configured agent name "StoClaw") instead.
        const isMainSession = currentSessionKey.endsWith(':main');
        if (!isMainSession) {
          if (shouldAutoDeriveSessionLabel(currentSessionKey, get().sessionLabels, isCorruptedSessionLabel)) {
            const labelText = deriveSessionLabelFromHistory(
              finalMessages,
              getMessageText,
              buildSessionLabelDerivationOptions(
                currentSessionKey,
                get().sessions,
                get().sessionLabels,
              ),
            );
            if (labelText) {
              set((s) => ({
                sessionLabels: {
                  ...s.sessionLabels,
                  [currentSessionKey]: truncateSessionLabel(labelText),
                },
              }));
            }
          }
        }

        // Record last activity time from the last message in history
        const lastMsg = finalMessages[finalMessages.length - 1];
        if (lastMsg?.timestamp) {
          const lastAt = toMs(lastMsg.timestamp);
          if (lastAt > 0) {
            set((s) => {
              const targetSession = s.sessions.find((session) => session.key === currentSessionKey);
              const listedAt = targetSession?.engineType === 'claude'
                ? 0
                : targetSession?.updatedAt ?? 0;
              const currentAt = s.sessionLastActivity[currentSessionKey] ?? 0;
              const nextAt = Math.max(currentAt, listedAt, lastAt);
              if (nextAt === currentAt) return {};
              return {
                sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nextAt },
              };
            });
          }
        }

        // Async: load missing image previews from disk (updates in background)
        loadMissingPreviews(finalMessages).then((updated) => {
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

        const { pendingFinal, lastUserMessageAt, sending: isSendingNow } = get();

        // If we're sending but haven't received streaming events, check
        // whether the loaded history reveals intermediate tool-call activity.
        // This surfaces progress via the pendingFinal → ActivityIndicator path.
        const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
        const isAfterUserMsg = (msg: RawMessage): boolean => {
          if (!userMsTs || !msg.timestamp) return true;
          return toMs(msg.timestamp) >= userMsTs;
        };

        if (isSendingNow && !pendingFinal) {
          const hasRecentAssistantActivity = [...filteredMessages].reverse().some((msg) => {
            if (msg.role !== 'assistant') return false;
            return isAfterUserMsg(msg);
          });
          if (hasRecentAssistantActivity) {
            set({ pendingFinal: true });
          }
        }

        // If pendingFinal, check whether the AI produced a final text response.
        if (pendingFinal || get().pendingFinal) {
          const recentAssistant = [...filteredMessages].reverse().find((msg) => {
            if (msg.role !== 'assistant') return false;
            if (!hasNonToolAssistantContent(msg)) return false;
            return isAfterUserMsg(msg);
          });
          if (recentAssistant) {
            clearHistoryPoll();
            set({
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              lastUserMessageAt: null,
            });
          }
        }
      };

      try {
        // Gateway chat.history does not support offset; load up to the hard max in one call.
        let thinkingLevel: string | null = null;
        const result = await hostApiFetch<{
          success?: boolean;
          result?: Record<string, unknown>;
          error?: string;
        }>(
          `/api/chat/history?sessionKey=${encodeURIComponent(currentSessionKey)}&limit=${CHAT_HISTORY_LENGTH_MAX_LIMIT}`
          + (currentSession?.engineType ? `&engineType=${encodeURIComponent(currentSession.engineType)}` : ''),
        );

        if (result.success === false || !result.result) {
          throw new Error(result.error || 'Gateway RPC failed: chat.history');
        }

        const data = result.result;
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
        if (rawMessages.length === 0 && (isCronSessionKey(currentSessionKey) || isCronDatedSessionKey(currentSessionKey))) {
          rawMessages = await loadCronFallbackMessages(currentSessionKey, CHAT_HISTORY_LIMIT);
        }
        if (rawMessages.length === 0 && isScheduledTaskSessionKey(currentSessionKey)) {
          rawMessages = await loadScheduledTaskFallbackMessages(currentSessionKey, CHAT_HISTORY_LIMIT);
        }
        if (rawMessages.length === 0 && isClaudeScheduledTaskSessionKey(currentSessionKey)) {
          rawMessages = await loadClaudeScheduledTaskFallbackMessages(currentSessionKey, CHAT_HISTORY_LIMIT);
        }
        applyLoadedMessages(rawMessages, thinkingLevel);
      } catch (err) {
        console.warn('Failed to load chat history:', err);
        let fallbackMessages = await loadCronFallbackMessages(currentSessionKey, CHAT_HISTORY_LIMIT);
        if (fallbackMessages.length === 0) {
          fallbackMessages = await loadScheduledTaskFallbackMessages(currentSessionKey, CHAT_HISTORY_LIMIT);
        }
        if (fallbackMessages.length === 0) {
          fallbackMessages = await loadClaudeScheduledTaskFallbackMessages(currentSessionKey, CHAT_HISTORY_LIMIT);
        }
        if (fallbackMessages.length > 0) {
          applyLoadedMessages(fallbackMessages, null);
        } else {
          set({ messages: [], loading: false, error: String(err) });
        }
      }
    },
  };
}
