import { dispatchBuiltinToolResult } from '@/lib/builtin-tool-dispatch';
import { noteObservedRun } from '@/lib/session-unread-notify';
import { touchSessionReadAt } from '@/stores/session-unread';
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
import type { ChatGet, ChatSet } from './store-api';
import type { AttachedFileMeta, ChatSession, RawMessage } from './types';
import { getAgentIdFromSessionKey } from './session-identity';
import { getSessionRuntimeState } from './session-runtime';
import { applyRuntimePatch } from './runtime-controller';
import { isVirtualTaskSessionKey } from './cron-session-utils';
import { clearStuckCheckTimer, setStuckCheckTimer } from './runtime-timers';
import {
  clearBackgroundRunActivity,
  noteBackgroundRunActivity,
  scheduleBackgroundRunWatchdog,
} from './background-run-watchdog';
import { appendStreamingAssistantSnapshot, appendStreamingToolResultSnapshot } from './streaming-state';
import { buildTerminalRuntimePatch, resolveAssistantFinalTurnState } from './turn-state-machine';
import { buildTerminalTurnEffects, executeTurnEffects } from './turn-effects';
import { logChatFlow } from './chat-flow-log';
import { decideRunEvent, recordTerminalRun } from './run-lifecycle';

export interface BackgroundChatEvent {
  sessionKey: string;
  resolvedState: string;
  runId: string;
  message: unknown;
  phase: unknown;
  errorMessage: string;
}

export interface BackgroundSessionEventDependencies {
  get: ChatGet;
  resolveEngineType: (sessions: ChatSession[], sessionKey: string, agentId: string) => ChatSession['engineType'];
  isToolOnlyMessage: (message: RawMessage) => boolean;
  markUnreadAfterRun: (sessionKey: string, currentSessionKey: string, options: { runId: string }) => void;
}

export function createBackgroundSessionEventHandler(dependencies: BackgroundSessionEventDependencies) {
  const { get, resolveEngineType, isToolOnlyMessage, markUnreadAfterRun } = dependencies;
  return (set: ChatSet, backgroundEvent: BackgroundChatEvent): void => {
    const {
      resolvedState,
      runId,
      sessionKey,
      message,
      phase,
      errorMessage,
    } = backgroundEvent;
    logChatFlow('event.background.apply', {
      state: resolvedState,
      runId,
      sessionKey,
    });
    const runtimeBefore = getSessionRuntimeState(get().runtimeBySessionKey, sessionKey);
    const decision = decideRunEvent({ sessionKey, runtime: runtimeBefore, resolvedState, runId });
    if (!decision.accept) {
      logChatFlow('event.background.rejected', {
        state: resolvedState,
        runId,
        sessionKey,
        activeRunId: runtimeBefore.activeRunId,
        reason: decision.reason,
      });
      return;
    }
    // G3: refresh "last observed activity" for any accepted event (incl. agent-only),
    // so the background-run watchdog doesn't misfire on long tasks that stream
    // agent-phase events between deltas.
    noteBackgroundRunActivity(sessionKey);
    if (decision.bindRun) {
      set((state) => {
        const runtimePatch = applyRuntimePatch(state, sessionKey, {
          sending: true,
          activeRunId: runId,
          error: null,
          sendAcceptance: runtimeBefore.sendAcceptance
            ? { ...runtimeBefore.sendAcceptance, status: 'accepted' }
            : null,
        });
        // Phase 2: a scheduled run fires in the background into a dated session
        // that may not yet exist in the sidebar list — the backend materializes
        // the transcript asynchronously after the run completes. Pre-instantiate
        // a placeholder entry (keyed by sessionKey for dedup) so the sidebar
        // shows the session — and its `sending` loading state — immediately.
        // `loadSessions` later overwrites this with the real transcript entry.
        const sessions = ensureVirtualTaskSessionEntry(
          state.sessions,
          sessionKey,
          resolveEngineType,
        );
        return sessions === state.sessions ? runtimePatch : { ...runtimePatch, sessions };
      });
      // G3: arm a watchdog on the shared stuck-check slot so a run whose final
      // never arrives (gateway crash / dropped event) can't leave the session
      // stuck in `sending` forever. Auto-cleared by recordTerminalRun on normal
      // terminal events. Scoped to virtual task sessions inside the scheduler.
      scheduleBackgroundRunWatchdog({
        get,
        set,
        sessionKey,
        runId,
        setStuckCheckTimer,
        clearStuckCheckTimer,
      });
    }
    switch (resolvedState) {
      case 'started': {
        noteObservedRun(runId);
        set((state) => applyRuntimePatch(state, sessionKey, {
          sending: true,
          activeRunId: runId || getSessionRuntimeState(state.runtimeBySessionKey, sessionKey).activeRunId,
          error: null,
        }));
        break;
      }
      case 'delta': {
        noteObservedRun(runId);
        const updates = collectToolUpdates(message, resolvedState);
        set((state) => applyRuntimePatch(state, sessionKey, (runtime) => ({
          sending: true,
          error: null,
          streamingMessage: isToolResultMessage(message) ? runtime.streamingMessage : message ?? runtime.streamingMessage,
          streamingMessages: appendStreamingAssistantSnapshot(runtime.streamingMessages, message),
          streamingTools: updates.length > 0 ? upsertToolStatuses(runtime.streamingTools, updates) : runtime.streamingTools,
        })));
        break;
      }
      case 'final': {
        const finalMessage = message as RawMessage | undefined;
        if (!finalMessage) {
          set((state) => applyRuntimePatch(state, sessionKey, {
            pendingFinal: true, streamingText: '', streamingMessage: null,
          }));
          break;
        }
        const updates = collectToolUpdates(finalMessage, resolvedState);
        if (isToolResultRole(finalMessage.role)) {
          applyToolResult(set, sessionKey, finalMessage, updates);
          void dispatchToolResultAndRefresh(get, sessionKey, finalMessage);
          break;
        }

        const toolOnly = isToolOnlyMessage(finalMessage);
        const currentState = get();
        const runtime = getSessionRuntimeState(currentState.runtimeBySessionKey, sessionKey);
        const engineType = resolveEngineType(currentState.sessions, sessionKey, getAgentIdFromSessionKey(sessionKey));
        const { isTerminalOutput } = resolveAssistantFinalTurnState({
          engineType,
          sending: runtime.sending,
          phase,
          message: finalMessage,
        });
        set((state) => {
          const patch = applyRuntimePatch(state, sessionKey, (currentRuntime) => ({
            sending: isTerminalOutput ? false : currentRuntime.sending,
            aborting: isTerminalOutput ? false : currentRuntime.aborting,
            activeRunId: isTerminalOutput ? null : currentRuntime.activeRunId,
            sendAcceptance: isTerminalOutput ? null : currentRuntime.sendAcceptance,
            streamingText: '',
            streamingMessage: null,
            streamingMessages: isTerminalOutput ? [] : currentRuntime.streamingMessages,
            streamingToolResults: isTerminalOutput ? [] : currentRuntime.streamingToolResults,
            streamingTools: isTerminalOutput ? [] : (updates.length > 0
              ? upsertToolStatuses(currentRuntime.streamingTools, updates)
              : currentRuntime.streamingTools),
            pendingFinal: !isTerminalOutput,
            pendingToolImages: isTerminalOutput ? [] : currentRuntime.pendingToolImages,
            lastUserMessageAt: isTerminalOutput ? null : currentRuntime.lastUserMessageAt,
            optimisticUserMessage: isTerminalOutput ? null : currentRuntime.optimisticUserMessage,
            error: null,
          }));
          if (isTerminalOutput) {
            if (sessionKey !== state.currentSessionKey) {
              markUnreadAfterRun(sessionKey, state.currentSessionKey, { runId });
            } else {
              touchSessionReadAt(sessionKey);
            }
          }
          return patch;
        });
        if (isTerminalOutput && !toolOnly) {
          executeTurnEffects(buildTerminalTurnEffects({
            agentId: getAgentIdFromSessionKey(sessionKey),
            runId: runId || undefined,
            sessionKey,
            engineType,
          }), { get, set });
        }
        if (isTerminalOutput) recordTerminalRun(sessionKey, runId);
        if (isTerminalOutput) clearBackgroundRunActivity(sessionKey);
        break;
      }
      case 'error':
        set((state) => applyRuntimePatch(state, sessionKey, buildTerminalRuntimePatch(
          errorMessage,
        )));
        recordTerminalRun(sessionKey, runId);
        clearBackgroundRunActivity(sessionKey);
        break;
      case 'aborted':
        set((state) => applyRuntimePatch(state, sessionKey, buildTerminalRuntimePatch(null)));
        recordTerminalRun(sessionKey, runId);
        clearBackgroundRunActivity(sessionKey);
        break;
      default:
        if (message && typeof message === 'object') {
          const updates = collectToolUpdates(message, 'delta');
          set((state) => applyRuntimePatch(state, sessionKey, (runtime) => ({
            streamingMessage: message ?? runtime.streamingMessage,
            streamingMessages: appendStreamingAssistantSnapshot(runtime.streamingMessages, message),
            streamingTools: updates.length > 0 ? upsertToolStatuses(runtime.streamingTools, updates) : runtime.streamingTools,
          })));
        }
    }
  };
}

function isToolResultMessage(message: unknown): boolean {
  return Boolean(message && typeof message === 'object' && isToolResultRole((message as RawMessage).role));
}

function applyToolResult(
  set: ChatSet,
  sessionKey: string,
  message: RawMessage,
  updates: ReturnType<typeof collectToolUpdates>,
): void {
  set((state) => {
    const runtime = getSessionRuntimeState(state.runtimeBySessionKey, sessionKey);
    const matchedPath = runtime.streamingMessage && message.toolCallId
      ? getToolCallFilePath(runtime.streamingMessage as RawMessage, message.toolCallId)
      : undefined;
    const files: AttachedFileMeta[] = [...extractImagesAsAttachedFiles(message.content)];
    if (matchedPath) {
      for (const file of files) {
        if (!file.filePath) {
          file.filePath = matchedPath;
          file.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
        }
      }
    }
    const text = getMessageText(message.content);
    if (text) {
      for (const ref of extractMediaRefs(text, { source: 'tool-result:media-attached', messageId: message.id, toolCallId: message.toolCallId })) {
        files.push(makeAttachedFile(ref));
      }
    }
    return applyRuntimePatch(state, sessionKey, {
      pendingFinal: true,
      streamingText: '',
      streamingMessage: null,
      streamingToolResults: appendStreamingToolResultSnapshot(runtime.streamingToolResults, message),
      pendingToolImages: files.length > 0 ? [...runtime.pendingToolImages, ...files] : runtime.pendingToolImages,
      streamingTools: updates.length > 0 ? upsertToolStatuses(runtime.streamingTools, updates) : runtime.streamingTools,
    });
  });
}

async function dispatchToolResultAndRefresh(get: ChatGet, sessionKey: string, message: RawMessage): Promise<void> {
  const agentId = getAgentIdFromSessionKey(sessionKey);
  await dispatchBuiltinToolResult({
    id: message.id, toolCallId: message.toolCallId, toolName: message.toolName, content: message.content,
  }, { sessionKey, agentId });
  const state = get();
  if (state.currentSessionKey === sessionKey) void state.loadHistory(true);
}

/**
 * Appends a placeholder `ChatSession` entry for a virtual task session key
 * (cron / claude-task dated) if it doesn't already exist in the sessions list.
 * The placeholder carries `engineType` + `agentId` so the sidebar renders the
 * correct icon and the background handler can resolve routing on subsequent
 * events.  `loadSessions` later overwrites this with the real transcript entry,
 * keyed by `sessionKey` for dedup.
 */
function ensureVirtualTaskSessionEntry(
  sessions: ChatSession[],
  sessionKey: string,
  resolveEngineType: (sessions: ChatSession[], sessionKey: string, agentId: string) => ChatSession['engineType'],
): ChatSession[] {
  if (!isVirtualTaskSessionKey(sessionKey)) return sessions;
  if (sessions.some((s) => s.key === sessionKey)) return sessions;
  const agentId = getAgentIdFromSessionKey(sessionKey);
  return [...sessions, {
    key: sessionKey,
    engineType: resolveEngineType(sessions, sessionKey, agentId),
    agentId,
  }];
}
