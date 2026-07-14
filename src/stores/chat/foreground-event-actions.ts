import {
  collectToolUpdates,
  getMessageText,
  isToolResultRole,
  upsertToolStatuses,
} from './helpers';
import { ensureWorkflowCardsInMessages } from '@/lib/workflow-card-injection';
import {
  appendStreamingAssistantSnapshot,
} from './streaming-state';
import { isDuplicateChatEvent } from './event-dedupe';
import { touchLastChatEventAt } from './history-finalization';
import { setRuntimePatch } from './runtime-controller';
import { normalizeChatEvent } from './normalized-chat-event';
import { handleForegroundAssistantFinal } from './foreground-assistant-final';
import {
  handleForegroundAbortedEvent,
  handleForegroundErrorEvent,
  handleForegroundFinalWithoutMessage,
} from './foreground-terminal-events';
import { handleForegroundToolResultFinal } from './foreground-tool-result-final';
import { buildTerminalTurnEffects, executeTurnEffects } from './turn-effects';
import { logChatFlow } from './chat-flow-log';
import type { BackgroundChatEvent } from './background-session-events';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import type { ChatSession, RawMessage } from './types';

export interface ForegroundEventDeps {
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
  ) => ChatSession['engineType'] | undefined;
  handleBackgroundSessionEvent: (
    set: ChatSet,
    event: BackgroundChatEvent,
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

  const runTerminalReloadEffects = (
    runId: string,
    sessionKey: string,
    engineType: ChatSession['engineType'] | undefined,
  ) => {
    executeTurnEffects(buildTerminalTurnEffects({
      agentId: get().currentAgentId,
      runId: runId || undefined,
      sessionKey,
      engineType,
      reloadHistory: true,
    }), { get, set, clearHistoryPoll, dispatchMemoryCapture: dispatchAgentMemoryCapture });
  };

  const syncWorkflowCardsForCurrentSession = () => {
    const sessionKey = get().currentSessionKey;
    const synced = ensureWorkflowCardsInMessages(
      get().messages,
      sessionKey,
      getMessageText,
    );
    if (synced !== get().messages) {
      set({ messages: synced });
    }
  };

  return {
    // ── Handle incoming chat events from Gateway ──

    handleChatEvent: (event: Record<string, unknown>) => {
      const { activeRunId, currentSessionKey } = get();
      const {
        eventState,
        errorMessage,
        message,
        phase,
        resolvedSessionKey,
        resolvedState,
        runId,
      } = normalizeChatEvent({ event, currentSessionKey });
      logChatFlow('event.foreground.normalized', {
        state: resolvedState,
        eventState,
        runId,
        eventSessionKey: event.sessionKey ?? null,
        resolvedSessionKey,
        currentSessionKey,
        hasMessage: message != null,
      });

      if (resolvedSessionKey != null && resolvedSessionKey !== currentSessionKey) {
        logChatFlow('event.background.route', {
          state: resolvedState,
          runId,
          sessionKey: resolvedSessionKey,
        });
        handleBackgroundSessionEvent(set, {
          sessionKey: resolvedSessionKey,
          resolvedState,
          runId,
          message,
          phase,
          errorMessage,
        });
        return;
      }

      // For active session events, also update runtimeBySessionKey so that
      // the sidebar shows loading for the current session.
      if (resolvedSessionKey != null && resolvedSessionKey === currentSessionKey) {
        logChatFlow('event.active.mirror', {
          state: resolvedState,
          runId,
          sessionKey: resolvedSessionKey,
          suppressTerminalEffects: true,
        });
        handleBackgroundSessionEvent(set, {
          sessionKey: resolvedSessionKey,
          resolvedState,
          runId,
          message,
          phase,
          errorMessage,
          suppressTerminalEffects: true,
        });
      }

      // Only process events for the active run (or if no active run set)
      if (activeRunId && runId && runId !== activeRunId) return;

      if (isDuplicateChatEvent(eventState, event)) return;

      touchLastChatEventAt(set);

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
          setRuntimePatch(set, currentSessionKey, { sending: true, activeRunId: runId, error: null });
        }
      }

      switch (resolvedState) {
        case 'started': {
          // Run just started (e.g. from console); show loading immediately.
          const { sending: currentSending } = get();
          if (!currentSending && runId) {
            setRuntimePatch(set, currentSessionKey, { sending: true, activeRunId: runId, error: null });
          }
          break;
        }
        case 'delta': {
          logChatFlow('event.delta.apply', {
            runId,
            sessionKey: currentSessionKey,
          });
          // If we're receiving new deltas, the Gateway has recovered from any
          // prior error — cancel the error finalization timer and clear the
          // stale error banner so the user sees the live stream again.
          if (hasErrorRecoveryTimer()) {
            clearErrorRecoveryTimer();
            setRuntimePatch(set, currentSessionKey, { error: null });
          }
          const updates = collectToolUpdates(message, resolvedState);
          setRuntimePatch(set, currentSessionKey, (runtime) => ({
            streamingMessage: (() => {
              if (message && typeof message === 'object') {
                const msgRole = (message as RawMessage).role;
                if (isToolResultRole(msgRole)) return runtime.streamingMessage;
              }
              return message ?? runtime.streamingMessage;
            })(),
            streamingMessages: appendStreamingAssistantSnapshot(runtime.streamingMessages, message),
            streamingTools: updates.length > 0 ? upsertToolStatuses(runtime.streamingTools, updates) : runtime.streamingTools,
          }));
          break;
        }
        case 'final': {
          logChatFlow('event.final.apply', {
            runId,
            sessionKey: currentSessionKey,
            hasMessage: message != null,
          });
          clearErrorRecoveryTimer();
          if (get().error) setRuntimePatch(set, currentSessionKey, { error: null });
          // Message complete - add to history and clear streaming
          const finalMsg = message as RawMessage | undefined;
          if (finalMsg) {
            const updates = collectToolUpdates(finalMsg, resolvedState);
            if (isToolResultRole(finalMsg.role)) {
              handleForegroundToolResultFinal({
                get,
                set,
                finalMessage: finalMsg,
                updates,
              });
              break;
            }
            const currentEngineType = resolveEngineTypeForSession(
              get().sessions,
              get().currentSessionKey,
              get().currentAgentId,
            );
            handleForegroundAssistantFinal({
              get,
              set,
              finalMessage: finalMsg,
              updates,
              runId,
              phase,
              sessionKey: currentSessionKey,
              engineType: currentEngineType,
              syncWorkflowCardsForCurrentSession,
              runTerminalReloadEffects,
            });
          } else {
            handleForegroundFinalWithoutMessage({
              get,
              set,
              runId,
              resolveEngineTypeForSession,
              dispatchAgentMemoryCapture,
            });
          }
          break;
        }
        case 'error': {
          handleForegroundErrorEvent({
            get,
            set,
            sessionKey: currentSessionKey,
            errorMessage,
            clearHistoryPoll,
            clearErrorRecoveryTimer,
            setErrorRecoveryTimer,
          });
          break;
        }
        case 'aborted': {
          handleForegroundAbortedEvent({
            set,
            sessionKey: currentSessionKey,
            clearHistoryPoll,
            clearErrorRecoveryTimer,
          });
          break;
        }
        default: {
          // Unknown or empty state — if we're currently sending and receive an event
          // with a message, attempt to process it as streaming data. This handles
          // edge cases where the Gateway sends events without a state field.
          const { sending } = get();
          if (sending && message && typeof message === 'object') {
            console.warn(`[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`, Object.keys(event));
            const updates = collectToolUpdates(message, 'delta');
            setRuntimePatch(set, currentSessionKey, (runtime) => ({
              streamingMessage: message ?? runtime.streamingMessage,
              streamingMessages: appendStreamingAssistantSnapshot(runtime.streamingMessages, message),
              streamingTools: updates.length > 0 ? upsertToolStatuses(runtime.streamingTools, updates) : runtime.streamingTools,
            }));
          }
          break;
        }
      }
    },

  };
}
