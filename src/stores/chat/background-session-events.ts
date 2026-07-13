import { dispatchBuiltinToolResult, syncWorkflowCardsAfterToolDispatch } from '@/lib/builtin-tool-dispatch';
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
import { resolveAssistantFinalTerminalState } from './run-completion';
import type { ChatGet, ChatSet } from './store-api';
import type { AttachedFileMeta, ChatSession, RawMessage } from './types';
import { getAgentIdFromSessionKey } from './session-identity';
import { getSessionRuntimeState, patchSessionRuntimeState } from './session-runtime';
import { appendStreamingAssistantSnapshot, appendStreamingToolResultSnapshot } from './streaming-state';

export interface BackgroundSessionEventDependencies {
  get: ChatGet;
  resolveEngineType: (sessions: ChatSession[], sessionKey: string, agentId: string) => ChatSession['engineType'];
  isToolOnlyMessage: (message: RawMessage) => boolean;
  dispatchMemoryCapture: (input: {
    agentId?: string | null;
    runId?: string | null;
    sessionKey?: string | null;
    engineType?: string | null;
  }) => void;
  markUnreadAfterRun: (sessionKey: string, currentSessionKey: string, options: { runId: string }) => void;
}

export function createBackgroundSessionEventHandler(dependencies: BackgroundSessionEventDependencies) {
  const { get, resolveEngineType, isToolOnlyMessage, dispatchMemoryCapture, markUnreadAfterRun } = dependencies;
  return (set: ChatSet, sessionKey: string, event: Record<string, unknown>, resolvedState: string, runId: string): void => {
    switch (resolvedState) {
      case 'started': {
        noteObservedRun(runId);
        set((state) => patchSessionRuntimeState(state, sessionKey, {
          sending: true,
          activeRunId: runId || getSessionRuntimeState(state.runtimeBySessionKey, sessionKey).activeRunId,
          error: null,
        }));
        break;
      }
      case 'delta': {
        noteObservedRun(runId);
        const updates = collectToolUpdates(event.message, resolvedState);
        set((state) => patchSessionRuntimeState(state, sessionKey, (runtime) => ({
          sending: true,
          error: null,
          streamingMessage: isToolResultMessage(event.message) ? runtime.streamingMessage : event.message ?? runtime.streamingMessage,
          streamingMessages: appendStreamingAssistantSnapshot(runtime.streamingMessages, event.message),
          streamingTools: updates.length > 0 ? upsertToolStatuses(runtime.streamingTools, updates) : runtime.streamingTools,
        })));
        break;
      }
      case 'final': {
        const finalMessage = event.message as RawMessage | undefined;
        if (!finalMessage) {
          set((state) => patchSessionRuntimeState(state, sessionKey, {
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
        const { isTerminalOutput } = resolveAssistantFinalTerminalState(
          engineType, runtime.sending, event.phase, finalMessage,
        );
        set((state) => {
          const patch = patchSessionRuntimeState(state, sessionKey, (currentRuntime) => ({
            sending: isTerminalOutput ? false : currentRuntime.sending,
            activeRunId: isTerminalOutput ? null : currentRuntime.activeRunId,
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
          dispatchMemoryCapture({ agentId: getAgentIdFromSessionKey(sessionKey), runId: runId || undefined, sessionKey, engineType });
        }
        break;
      }
      case 'error':
        set((state) => patchSessionRuntimeState(state, sessionKey, terminalRuntimePatch(
          String(event.errorMessage || 'An error occurred'),
        )));
        break;
      case 'aborted':
        set((state) => patchSessionRuntimeState(state, sessionKey, terminalRuntimePatch(null)));
        break;
      default:
        if (event.message && typeof event.message === 'object') {
          const updates = collectToolUpdates(event.message, 'delta');
          set((state) => patchSessionRuntimeState(state, sessionKey, (runtime) => ({
            streamingMessage: event.message ?? runtime.streamingMessage,
            streamingMessages: appendStreamingAssistantSnapshot(runtime.streamingMessages, event.message),
            streamingTools: updates.length > 0 ? upsertToolStatuses(runtime.streamingTools, updates) : runtime.streamingTools,
          })));
        }
    }
  };
}

function isToolResultMessage(message: unknown): boolean {
  return Boolean(message && typeof message === 'object' && isToolResultRole((message as RawMessage).role));
}

function terminalRuntimePatch(error: string | null) {
  return {
    sending: false, activeRunId: null, streamingText: '', streamingMessage: null,
    streamingMessages: [], streamingToolResults: [], streamingTools: [], pendingFinal: false,
    lastUserMessageAt: null, optimisticUserMessage: null, pendingToolImages: [], error,
  };
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
    return patchSessionRuntimeState(state, sessionKey, {
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
  syncWorkflowCardsAfterToolDispatch(sessionKey);
  const state = get();
  if (state.currentSessionKey === sessionKey) void state.loadHistory(true);
}
