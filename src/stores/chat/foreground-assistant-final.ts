import {
  getMessageText,
  upsertToolStatuses,
} from './helpers';
import {
  hasNonToolAssistantContent,
  isToolOnlyMessage,
  maybeAppendWorkflowParameterForm,
} from './message-content';
import { setRuntimePatch } from './runtime-controller';
import { resolveAssistantFinalTurnState } from './turn-state-machine';
import { logChatFlow } from './chat-flow-log';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession, RawMessage } from './types';

export function handleForegroundAssistantFinal(input: {
  get: ChatGet;
  set: ChatSet;
  finalMessage: RawMessage;
  updates: Parameters<typeof upsertToolStatuses>[1];
  runId: string;
  phase: unknown;
  sessionKey: string;
  engineType?: ChatSession['engineType'];
  syncWorkflowCardsForCurrentSession: () => void;
  runTerminalReloadEffects: (
    runId: string,
    sessionKey: string,
    engineType: ChatSession['engineType'] | undefined,
  ) => void;
}): void {
  const {
    engineType,
    finalMessage,
    get,
    phase,
    runId,
    runTerminalReloadEffects,
    sessionKey,
    set,
    syncWorkflowCardsForCurrentSession,
    updates,
  } = input;

  const toolOnly = isToolOnlyMessage(finalMessage);
  const { isTerminalOutput } = resolveAssistantFinalTurnState({
    engineType,
    sending: get().sending,
    phase,
    message: finalMessage,
  });
  logChatFlow('event.final.assistant', {
    runId,
    sessionKey,
    engineType,
    isTerminalOutput,
    toolOnly,
    phase: phase ?? null,
    hasOutput: hasNonToolAssistantContent(finalMessage),
  });

  // OpenClaw gateway final events carry a merged stream buffer, not the
  // transcript's last assistant reply. On terminal final, reload history.
  const deferFinalToHistory =
    engineType !== 'claude'
    && isTerminalOutput
    && !toolOnly;
  if (deferFinalToHistory) {
    setRuntimePatch(set, sessionKey, {
      streamingText: '',
      streamingMessage: null,
      streamingMessages: [],
      streamingToolResults: [],
      streamingTools: [],
      pendingToolImages: [],
      sending: false,
      aborting: false,
      activeRunId: null,
      sendAcceptance: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      optimisticUserMessage: null,
    });
    runTerminalReloadEffects(runId, get().currentSessionKey, engineType);
    return;
  }

  const msgId = finalMessage.id || (toolOnly
    ? `run-${runId}-tool-${Date.now()}`
    : isTerminalOutput
      ? `run-${runId || 'unknown'}`
      : `run-${runId || 'unknown'}-part-${Date.now()}-${crypto.randomUUID()}`);

  set((state) => {
    const pendingImgs = state.pendingToolImages;
    let msgWithImages: RawMessage = pendingImgs.length > 0
      ? {
        ...finalMessage,
        role: (finalMessage.role || 'assistant') as RawMessage['role'],
        id: msgId,
        _attachedFiles: [...(finalMessage._attachedFiles || []), ...pendingImgs],
      }
      : { ...finalMessage, role: (finalMessage.role || 'assistant') as RawMessage['role'], id: msgId };

    if (isTerminalOutput) {
      msgWithImages = maybeAppendWorkflowParameterForm(msgWithImages);
    }

    const alreadyExists = state.messages.some(message => message.id === msgId);
    const incomingText = getMessageText(msgWithImages.content).trim();
    let lastUserIndex = -1;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }
    const hasEquivalentAssistantAfterLastUser = isTerminalOutput && incomingText.length > 0
      && state.messages.slice(lastUserIndex + 1).some((message) => (
        message.role === 'assistant'
        && hasNonToolAssistantContent(message)
        && getMessageText(message.content).trim() === incomingText
      ));

    if (alreadyExists) {
      if (isTerminalOutput && msgWithImages.content !== state.messages.find(message => message.id === msgId)?.content) {
        const updatedMessages = state.messages.map(message =>
          message.id === msgId ? msgWithImages : message
        );
        return { messages: updatedMessages };
      }
      return {};
    }

    if (hasEquivalentAssistantAfterLastUser) {
      return {};
    }

    return {
      messages: [...state.messages, msgWithImages],
    };
  });

  setRuntimePatch(set, sessionKey, (runtime) => {
    const nextTools = updates.length > 0
      ? upsertToolStatuses(runtime.streamingTools, updates)
      : runtime.streamingTools;
    return {
      streamingText: '',
      streamingMessage: null,
      streamingMessages: isTerminalOutput ? [] : runtime.streamingMessages,
      streamingToolResults: isTerminalOutput ? [] : runtime.streamingToolResults,
      sending: toolOnly ? runtime.sending : (isTerminalOutput ? false : runtime.sending),
      aborting: isTerminalOutput ? false : runtime.aborting,
      activeRunId: toolOnly ? runtime.activeRunId : (isTerminalOutput ? null : runtime.activeRunId),
      sendAcceptance: isTerminalOutput ? null : runtime.sendAcceptance,
      pendingFinal: toolOnly ? true : (isTerminalOutput ? false : true),
      streamingTools: isTerminalOutput ? [] : nextTools,
      pendingToolImages: [],
    };
  });

  if (isTerminalOutput && !toolOnly) {
    logChatFlow('event.final.terminal.effects', {
      runId,
      sessionKey,
      engineType,
    });
    syncWorkflowCardsForCurrentSession();
    runTerminalReloadEffects(runId, get().currentSessionKey, engineType);
  }
}
