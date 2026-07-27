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
import { decideRunEvent, recordTerminalRun } from './run-lifecycle';
import { getSessionRuntimeState } from './session-runtime';

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
  clearHistoryPoll: (sessionKey: string) => void;
  clearErrorRecoveryTimer: (sessionKey: string) => void;
  setErrorRecoveryTimer: (sessionKey: string, timer: ReturnType<typeof setTimeout> | null) => void;
  hasErrorRecoveryTimer: (sessionKey: string) => boolean;
}

export function createForegroundEventActions(
  set: ChatSet,
  get: ChatGet,
  deps: ForegroundEventDeps,
): Pick<RuntimeActions, 'handleChatEvent'> {
  const {
    resolveEngineTypeForSession,
    handleBackgroundSessionEvent,
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
    }), {
      get,
      set,
      clearHistoryPoll: () => clearHistoryPoll(sessionKey),
    });
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
      const { currentSessionKey } = get();
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

      // Deduplicate before any foreground/background runtime mutation. The old
      // ordering mirrored active events into the background reducer first, so
      // duplicate/error events could terminalize a run before foreground recovery.
      if (isDuplicateChatEvent(eventState, event)) return;

      const targetSessionKey = resolvedSessionKey ?? currentSessionKey;
      const runtime = getSessionRuntimeState(get().runtimeBySessionKey, targetSessionKey);
      const decision = decideRunEvent({
        sessionKey: targetSessionKey,
        runtime,
        resolvedState,
        runId,
      });
      if (!decision.accept) {
        logChatFlow('event.run.rejected', {
          sessionKey: targetSessionKey,
          runId,
          activeRunId: runtime.activeRunId,
          state: resolvedState,
          reason: decision.reason,
        });
        return;
      }
      if (decision.bindRun) {
        setRuntimePatch(set, targetSessionKey, {
          sending: true,
          activeRunId: runId,
          error: null,
          sendAcceptance: runtime.sendAcceptance
            ? { ...runtime.sendAcceptance, status: 'accepted' }
            : null,
        });
      }

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

      touchLastChatEventAt(set);

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
          if (hasErrorRecoveryTimer(currentSessionKey)) {
            clearErrorRecoveryTimer(currentSessionKey);
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
          clearErrorRecoveryTimer(currentSessionKey);
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
            });
          }
          break;
        }
        case 'error': {
          handleForegroundErrorEvent({
            get,
            set,
            sessionKey: currentSessionKey,
            runId,
            errorMessage,
            clearHistoryPoll: () => clearHistoryPoll(currentSessionKey),
            clearErrorRecoveryTimer: () => clearErrorRecoveryTimer(currentSessionKey),
            setErrorRecoveryTimer: (timer) => setErrorRecoveryTimer(currentSessionKey, timer),
          });
          break;
        }
        case 'aborted': {
          handleForegroundAbortedEvent({
            set,
            sessionKey: currentSessionKey,
            runId,
            clearHistoryPoll: () => clearHistoryPoll(currentSessionKey),
            clearErrorRecoveryTimer: () => clearErrorRecoveryTimer(currentSessionKey),
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

      if (
        runId
        && (resolvedState === 'final' || resolvedState === 'aborted')
      ) {
        const latest = getSessionRuntimeState(get().runtimeBySessionKey, currentSessionKey);
        if (!latest.sending && latest.activeRunId !== runId) {
          recordTerminalRun(currentSessionKey, runId);
        }
      }
    },

  };
}
