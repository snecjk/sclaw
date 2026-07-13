import {
  getClaudeTaskRunSessionAggregateKey,
  getCronRunSessionAggregateKey,
  parseClaudeScheduledTaskSessionKey,
  parseCronSessionKey,
} from './cron-session-utils';
import {
  collectToolUpdates,
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  getMessageText,
  getToolCallFilePath,
  isToolResultRole,
  makeAttachedFile,
  upsertToolStatuses,
} from './helpers';
import { parseStoToolEnvelope, type WorkflowSchemaReadyData } from '@/lib/builtin-tool-envelope';
import { dispatchBuiltinToolResult } from '@/lib/builtin-tool-dispatch';
import {
  applyWorkflowSchemaReady,
  ensureWorkflowParameterFormInjected,
  patchLastAssistantWithWorkflowForm,
} from './parameter-form-recovery';
import { ensureWorkflowCardsInMessages } from '@/lib/workflow-card-injection';
import { resolveAssistantFinalTerminalState } from './run-completion';
import {
  appendStreamingAssistantSnapshot,
  appendStreamingToolResultSnapshot,
} from './streaming-state';
import { isDuplicateChatEvent } from './event-dedupe';
import { finalizeMessagesFromHistoryLoad, touchLastChatEventAt } from './history-finalization';
import { hasNonToolAssistantContent, isToolOnlyMessage, maybeAppendWorkflowParameterForm } from './message-content';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import type { AttachedFileMeta, ChatSession, RawMessage } from './types';

export interface ForegroundEventDeps {
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
  ) => ChatSession['engineType'] | undefined;
  handleBackgroundSessionEvent: (
    set: ChatSet,
    sessionKey: string,
    event: Record<string, unknown>,
    resolvedState: string,
    runId: string,
  ) => void;
  dispatchAgentMemoryCapture: (input: {
    agentId?: string | null;
    runId?: string | null;
    sessionKey?: string | null;
    engineType?: ChatSession['engineType'];
  }) => void;
  clearHistoryPoll: () => void;
  clearErrorRecoveryTimer: () => void;
  setErrorRecoveryTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
  hasErrorRecoveryTimer: () => boolean;
}

export function createForegroundEventActions(
  set: ChatSet,
  get: ChatGet,
  deps: ForegroundEventDeps,
): Pick<RuntimeActions, 'handleChatEvent'> {
  const {
    resolveEngineTypeForSession,
    handleBackgroundSessionEvent,
    dispatchAgentMemoryCapture,
    clearHistoryPoll,
    clearErrorRecoveryTimer,
    setErrorRecoveryTimer,
    hasErrorRecoveryTimer,
  } = deps;

  return {
    // ── Handle incoming chat events from Gateway ──

    handleChatEvent: (event: Record<string, unknown>) => {
      const runId = String(event.runId || '');
      const eventState = String(event.state || '');
      const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
      const { activeRunId, currentSessionKey } = get();

      // Map cron run session events to their daily aggregate session key so that
      // the loading indicator appears on the aggregate session in the sidebar.
      // Also map base cron keys to dated keys when the current session is dated.
      let resolvedSessionKey = eventSessionKey;
      if (eventSessionKey) {
        // Map cron run session events to daily aggregate key
        const cronAggregateKey = getCronRunSessionAggregateKey(eventSessionKey);
        if (cronAggregateKey) {
          resolvedSessionKey = cronAggregateKey;
        } else {
          // Map Claude task run session events to daily aggregate key
          const claudeAggregateKey = getClaudeTaskRunSessionAggregateKey(eventSessionKey);
          if (claudeAggregateKey) {
            resolvedSessionKey = claudeAggregateKey;
          } else {
            // If eventSessionKey is a base cron key (no date, no run), and current
            // session is a dated key for the same job, map to the dated key.
            const parsed = parseCronSessionKey(eventSessionKey);
            if (parsed && !parsed.date && !parsed.runSessionId && currentSessionKey) {
              const currentParsed = parseCronSessionKey(currentSessionKey);
              if (currentParsed && currentParsed.date && currentParsed.jobId === parsed.jobId) {
                resolvedSessionKey = currentSessionKey;
              }
            }
            // If eventSessionKey is a base claude-task key (no date), and current
            // session is a dated key for the same task, map to the dated key.
            const claudeParsed = parseClaudeScheduledTaskSessionKey(eventSessionKey);
            if (claudeParsed && !claudeParsed.date && currentSessionKey) {
              const currentClaudeParsed = parseClaudeScheduledTaskSessionKey(currentSessionKey);
              if (currentClaudeParsed && currentClaudeParsed.date && currentClaudeParsed.taskId === claudeParsed.taskId) {
                resolvedSessionKey = currentSessionKey;
              }
            }
          }
        }
      }

      if (resolvedSessionKey != null && resolvedSessionKey !== currentSessionKey) {
        let resolvedState = eventState;
        if (!resolvedState && event.message && typeof event.message === 'object') {
          const msg = event.message as Record<string, unknown>;
          const stopReason = msg.stopReason ?? msg.stop_reason;
          if (stopReason) {
            resolvedState = 'final';
          } else if (msg.role || msg.content) {
            resolvedState = 'delta';
          }
        }
        handleBackgroundSessionEvent(set, resolvedSessionKey, event, resolvedState, runId);
        return;
      }

      // For active session events, also update runtimeBySessionKey so that
      // the sidebar shows loading for the current session.
      if (resolvedSessionKey != null && resolvedSessionKey === currentSessionKey) {
        let resolvedState = eventState;
        if (!resolvedState && event.message && typeof event.message === 'object') {
          const msg = event.message as Record<string, unknown>;
          const stopReason = msg.stopReason ?? msg.stop_reason;
          if (stopReason) {
            resolvedState = 'final';
          } else if (msg.role || msg.content) {
            resolvedState = 'delta';
          }
        }
        handleBackgroundSessionEvent(set, resolvedSessionKey, event, resolvedState, runId);
      }

      // Only process events for the active run (or if no active run set)
      if (activeRunId && runId && runId !== activeRunId) return;

      if (isDuplicateChatEvent(eventState, event)) return;

      touchLastChatEventAt(set);

      // Defensive: if state is missing but we have a message, try to infer state.
      let resolvedState = eventState;
      if (!resolvedState && event.message && typeof event.message === 'object') {
        const msg = event.message as Record<string, unknown>;
        const stopReason = msg.stopReason ?? msg.stop_reason;
        if (stopReason) {
          resolvedState = 'final';
        } else if (msg.role || msg.content) {
          resolvedState = 'delta';
        }
      }

      // Only pause the history poll when we receive actual streaming data.
      // The gateway sends "agent" events with { phase, startedAt } that carry
      // no message — these must NOT kill the poll, since the poll is our only
      // way to track progress when the gateway doesn't stream intermediate turns.
      const hasUsefulData = resolvedState === 'delta' || resolvedState === 'final'
        || resolvedState === 'error' || resolvedState === 'aborted';
      if (hasUsefulData) {
        if (resolvedState !== 'final') {
          clearHistoryPoll();
        }
        // Adopt run started from another client (e.g. console at 127.0.0.1:18789):
        // show loading/streaming in the app when this session has an active run.
        const { sending } = get();
        if (!sending && runId) {
          set({ sending: true, activeRunId: runId, error: null });
        }
      }

      switch (resolvedState) {
        case 'started': {
          // Run just started (e.g. from console); show loading immediately.
          const { sending: currentSending } = get();
          if (!currentSending && runId) {
            set({ sending: true, activeRunId: runId, error: null });
          }
          break;
        }
        case 'delta': {
          // If we're receiving new deltas, the Gateway has recovered from any
          // prior error — cancel the error finalization timer and clear the
          // stale error banner so the user sees the live stream again.
          if (hasErrorRecoveryTimer()) {
            clearErrorRecoveryTimer();
            set({ error: null });
          }
          const updates = collectToolUpdates(event.message, resolvedState);
          set((s) => ({
            streamingMessage: (() => {
              if (event.message && typeof event.message === 'object') {
                const msgRole = (event.message as RawMessage).role;
                if (isToolResultRole(msgRole)) return s.streamingMessage;
              }
              return event.message ?? s.streamingMessage;
            })(),
            streamingMessages: appendStreamingAssistantSnapshot(s.streamingMessages, event.message),
            streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
          }));
          break;
        }
        case 'final': {
          clearErrorRecoveryTimer();
          if (get().error) set({ error: null });
          // Message complete - add to history and clear streaming
          const finalMsg = event.message as RawMessage | undefined;
          if (finalMsg) {
            const updates = collectToolUpdates(finalMsg, resolvedState);
            if (isToolResultRole(finalMsg.role)) {
              const schemaEnvelope = parseStoToolEnvelope(finalMsg.content);
              if (schemaEnvelope?.type === 'workflow_schema_ready' && schemaEnvelope.success) {
                applyWorkflowSchemaReady((schemaEnvelope.data ?? {}) as WorkflowSchemaReadyData);
              }

              // Resolve file path from the active assistant tool call before clearing it.
              const currentStreamForPath = get().streamingMessage as RawMessage | null;
              const matchedPath = (currentStreamForPath && finalMsg.toolCallId)
                ? getToolCallFilePath(currentStreamForPath, finalMsg.toolCallId)
                : undefined;

              const toolFiles: AttachedFileMeta[] = [
                ...extractImagesAsAttachedFiles(finalMsg.content),
              ];
              if (matchedPath) {
                for (const f of toolFiles) {
                  if (!f.filePath) {
                    f.filePath = matchedPath;
                    f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
                  }
                }
              }
              const text = getMessageText(finalMsg.content);
              if (text) {
                const mediaRefs = extractMediaRefs(text, {
                  source: 'tool-result:media-attached',
                  messageId: finalMsg.id,
                  toolCallId: finalMsg.toolCallId,
                });
                for (const ref of mediaRefs) toolFiles.push(makeAttachedFile(ref));
              }
              set((s) => ({
                streamingText: '',
                streamingMessage: null,
                streamingToolResults: appendStreamingToolResultSnapshot(s.streamingToolResults, finalMsg),
                pendingFinal: true,
                pendingToolImages: toolFiles.length > 0
                  ? [...s.pendingToolImages, ...toolFiles]
                  : s.pendingToolImages,
                streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
              }));
              void (async () => {
                const sessionKey = get().currentSessionKey;
                const agentId = get().currentAgentId;
                await dispatchBuiltinToolResult({
                  id: finalMsg.id,
                  toolCallId: finalMsg.toolCallId,
                  toolName: finalMsg.toolName,
                  content: finalMsg.content,
                }, { sessionKey, agentId });
                let nextMessages = get().messages;
                const withForm = patchLastAssistantWithWorkflowForm(nextMessages, getMessageText);
                if (withForm !== nextMessages) {
                  nextMessages = withForm;
                  set({ messages: withForm });
                }
                const withCards = ensureWorkflowCardsInMessages(
                  nextMessages,
                  sessionKey,
                  getMessageText,
                );
                if (withCards !== nextMessages) {
                  set({ messages: withCards });
                }
                ensureWorkflowParameterFormInjected(getMessageText);
                void get().loadHistory(true);
              })();
              break;
            }
            const toolOnly = isToolOnlyMessage(finalMsg);
            const currentEngineType = resolveEngineTypeForSession(
              get().sessions,
              get().currentSessionKey,
              get().currentAgentId,
            );
            const { isTerminalOutput } = resolveAssistantFinalTerminalState(
              currentEngineType,
              get().sending,
              event.phase,
              finalMsg,
            );

            // OpenClaw gateway final events carry a merged stream buffer, not the
            // transcript's last assistant reply. On terminal final, reload history.
            const deferFinalToHistory =
              currentEngineType !== 'claude'
              && isTerminalOutput
              && !toolOnly;
            if (deferFinalToHistory) {
              set(() => ({
                streamingText: '',
                streamingMessage: null,
                streamingMessages: [],
                streamingToolResults: [],
                streamingTools: [],
                pendingToolImages: [],
                sending: false,
                activeRunId: null,
                pendingFinal: false,
                lastUserMessageAt: null,
                optimisticUserMessage: null,
              }));
              clearHistoryPoll();
              const sessionKey = get().currentSessionKey;
              dispatchAgentMemoryCapture({
                agentId: get().currentAgentId,
                runId: runId || undefined,
                sessionKey,
                engineType: currentEngineType,
              });
              void get().loadHistory(true, true).then(() => {
                finalizeMessagesFromHistoryLoad(get, set, {
                  agentId: get().currentAgentId,
                  runId: runId || undefined,
                  sessionKey,
                });
              });
              break;
            }

            const msgId = finalMsg.id || (toolOnly
              ? `run-${runId}-tool-${Date.now()}`
              : isTerminalOutput
                ? `run-${runId || 'unknown'}`
                : `run-${runId || 'unknown'}-part-${Date.now()}-${crypto.randomUUID()}`);
            set((s) => {
              const nextTools = updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools;
              const streamingTools = isTerminalOutput ? [] : nextTools;
              const streamingMessages = isTerminalOutput ? [] : s.streamingMessages;
              const streamingToolResults = isTerminalOutput ? [] : s.streamingToolResults;

              // Attach any images collected from preceding tool results
              const pendingImgs = s.pendingToolImages;
              let msgWithImages: RawMessage = pendingImgs.length > 0
                ? {
                  ...finalMsg,
                  role: (finalMsg.role || 'assistant') as RawMessage['role'],
                  id: msgId,
                  _attachedFiles: [...(finalMsg._attachedFiles || []), ...pendingImgs],
                }
                : { ...finalMsg, role: (finalMsg.role || 'assistant') as RawMessage['role'], id: msgId };

              // If we are in a workflow guidance phase AND this is the final
              // assistant output (hasOutput=true), append an interactive
              // parameter_form block to the assistant message for the user.
              if (isTerminalOutput) {
                msgWithImages = maybeAppendWorkflowParameterForm(msgWithImages);
              }

              const clearPendingImages = { pendingToolImages: [] as AttachedFileMeta[] };

              // Check if message already exists (prevent duplicates)
              const alreadyExists = s.messages.some(m => m.id === msgId);
              const incomingText = getMessageText(msgWithImages.content).trim();
              let lastUserIndex = -1;
              for (let i = s.messages.length - 1; i >= 0; i--) {
                if (s.messages[i].role === 'user') {
                  lastUserIndex = i;
                  break;
                }
              }
              const hasEquivalentAssistantAfterLastUser = isTerminalOutput && incomingText.length > 0
                && s.messages.slice(lastUserIndex + 1).some((m) => (
                  m.role === 'assistant'
                  && hasNonToolAssistantContent(m)
                  && getMessageText(m.content).trim() === incomingText
                ));
              if (alreadyExists) {
                // If message already exists but hasOutput, we still need to append
                // the parameter_form to it. Update the existing message in messages[].
                if (isTerminalOutput && msgWithImages.content !== s.messages.find(m => m.id === msgId)?.content) {
                  const updatedMessages = s.messages.map(m =>
                    m.id === msgId ? msgWithImages : m
                  );
                  return toolOnly ? {
                    messages: updatedMessages,
                    streamingText: '',
                    streamingMessage: null,
                    streamingMessages,
                    streamingToolResults,
                    pendingFinal: true,
                    streamingTools,
                    ...clearPendingImages,
                  } : {
                    messages: updatedMessages,
                    streamingText: '',
                    streamingMessage: null,
                    streamingMessages,
                    streamingToolResults,
                    sending: isTerminalOutput ? false : s.sending,
                    activeRunId: isTerminalOutput ? null : s.activeRunId,
                    pendingFinal: isTerminalOutput ? false : true,
                    streamingTools,
                    ...clearPendingImages,
                  };
                }
                return toolOnly ? {
                  streamingText: '',
                  streamingMessage: null,
                  streamingMessages,
                  streamingToolResults,
                  pendingFinal: true,
                  streamingTools,
                  ...clearPendingImages,
                } : {
                  streamingText: '',
                  streamingMessage: null,
                  streamingMessages,
                  streamingToolResults,
                  sending: isTerminalOutput ? false : s.sending,
                  activeRunId: isTerminalOutput ? null : s.activeRunId,
                  pendingFinal: isTerminalOutput ? false : true,
                  streamingTools,
                  ...clearPendingImages,
                };
              }
              if (hasEquivalentAssistantAfterLastUser) {
                return {
                  streamingText: '',
                  streamingMessage: null,
                  streamingMessages: [],
                  streamingToolResults: [],
                  sending: false,
                  activeRunId: null,
                  pendingFinal: false,
                  streamingTools: [],
                  ...clearPendingImages,
                };
              }
              return toolOnly ? {
                messages: [...s.messages, msgWithImages],
                streamingText: '',
                streamingMessage: null,
                streamingMessages,
                streamingToolResults,
                pendingFinal: true,
                streamingTools,
                ...clearPendingImages,
              } : {
                messages: [...s.messages, msgWithImages],
                streamingText: '',
                streamingMessage: null,
                streamingMessages,
                streamingToolResults,
                sending: isTerminalOutput ? false : s.sending,
                activeRunId: isTerminalOutput ? null : s.activeRunId,
                pendingFinal: isTerminalOutput ? false : true,
                streamingTools,
                ...clearPendingImages,
              };
            });
            if (isTerminalOutput && !toolOnly) {
              const sessionKey = get().currentSessionKey;
              const synced = ensureWorkflowCardsInMessages(
                get().messages,
                sessionKey,
                getMessageText,
              );
              if (synced !== get().messages) {
                set({ messages: synced });
              }
            }
            // After the final response, quietly reload history to surface all intermediate
            // tool-use turns (thinking + tool blocks) from the Gateway's authoritative record.
              if (isTerminalOutput && !toolOnly) {
                clearHistoryPoll();
                const sessionKey = get().currentSessionKey;
                dispatchAgentMemoryCapture({
                  agentId: get().currentAgentId,
                  runId: runId || undefined,
                  sessionKey,
                  engineType: currentEngineType,
                });
                void get().loadHistory(true, true).then(() => {
                  finalizeMessagesFromHistoryLoad(get, set, {
                    agentId: get().currentAgentId,
                    runId: runId || undefined,
                    sessionKey,
                  });
                });
              }
          } else {
            // No message in final event - reload history to get complete data
            set({ streamingText: '', streamingMessage: null, pendingFinal: true });
            dispatchAgentMemoryCapture({
              agentId: get().currentAgentId,
              runId: runId || undefined,
              sessionKey: get().currentSessionKey,
              engineType: resolveEngineTypeForSession(
                get().sessions,
                get().currentSessionKey,
                get().currentAgentId,
              ),
            });
            get().loadHistory();
          }
          break;
        }
        case 'error': {
          const errorMsg = String(event.errorMessage || 'An error occurred');
          const wasSending = get().sending;

          // Snapshot the current streaming message into messages[] so partial
          // content ("Let me get that written down...") is preserved in the UI
          // rather than being silently discarded.
          const currentStream = get().streamingMessage as RawMessage | null;
          if (currentStream && (currentStream.role === 'assistant' || currentStream.role === undefined)) {
            const snapId = (currentStream as RawMessage).id
              || `error-snap-${Date.now()}`;
            const alreadyExists = get().messages.some(m => m.id === snapId);
            if (!alreadyExists) {
              set((s) => ({
                messages: [...s.messages, { ...currentStream, role: 'assistant' as const, id: snapId }],
              }));
            }
          }

          set({
            error: errorMsg,
            streamingText: '',
            streamingMessage: null,
            streamingMessages: [],
            streamingToolResults: [],
            streamingTools: [],
            pendingFinal: false,
            pendingToolImages: [],
          });

          // Don't immediately give up: the Gateway often retries internally
          // after transient API failures (e.g. "terminated"). Keep `sending`
          // true for a grace period so that recovery events are processed and
          // the agent-phase-completion handler can still trigger loadHistory.
          if (wasSending) {
            clearErrorRecoveryTimer();
            const ERROR_RECOVERY_GRACE_MS = 15_000;
            setErrorRecoveryTimer(setTimeout(() => {
              setErrorRecoveryTimer(null);
              const state = get();
              if (state.sending && !state.streamingMessage) {
                clearHistoryPoll();
                // Grace period expired with no recovery — finalize the error
                set({
                  sending: false,
                  activeRunId: null,
                  lastUserMessageAt: null,
                });
                // One final history reload in case the Gateway completed in the
                // background and we just missed the event.
                state.loadHistory(true);
              }
            }, ERROR_RECOVERY_GRACE_MS));
          } else {
            clearHistoryPoll();
            set({ sending: false, activeRunId: null, lastUserMessageAt: null, optimisticUserMessage: null });
          }
          break;
        }
        case 'aborted': {
          clearHistoryPoll();
          clearErrorRecoveryTimer();
          set({
            sending: false,
            activeRunId: null,
            streamingText: '',
            streamingMessage: null,
            streamingMessages: [],
            streamingToolResults: [],
            streamingTools: [],
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
          });
          break;
        }
        default: {
          // Unknown or empty state — if we're currently sending and receive an event
          // with a message, attempt to process it as streaming data. This handles
          // edge cases where the Gateway sends events without a state field.
          const { sending } = get();
          if (sending && event.message && typeof event.message === 'object') {
            console.warn(`[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`, Object.keys(event));
            const updates = collectToolUpdates(event.message, 'delta');
            set((s) => ({
              streamingMessage: event.message ?? s.streamingMessage,
              streamingMessages: appendStreamingAssistantSnapshot(s.streamingMessages, event.message),
              streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
            }));
          }
          break;
        }
      }
    },

  };
}
