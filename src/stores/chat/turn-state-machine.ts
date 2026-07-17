import {
  resolveAssistantFinalTerminalState as resolveAssistantFinalTerminalStateCore,
  shouldAutoCompleteClaudeFromHistory as shouldAutoCompleteClaudeFromHistoryCore,
} from './run-completion';
import type { RawMessage, SessionRuntimeState } from './types';

export function resolveAssistantFinalTurnState(input: {
  engineType: string | undefined;
  sending: boolean;
  phase: unknown;
  message: RawMessage;
}): { isAgenticRunFragment: boolean; isTerminalOutput: boolean } {
  return resolveAssistantFinalTerminalStateCore(
    input.engineType,
    input.sending,
    input.phase,
    input.message,
  );
}

export function shouldAutoCompleteTurnFromHistory(input: {
  engineType: string | undefined;
  runtimeState: { isRunning?: boolean; runtimeResult?: unknown } | undefined;
  hasRecentAssistant: boolean;
}): boolean {
  return shouldAutoCompleteClaudeFromHistoryCore(
    input.engineType,
    input.runtimeState,
    input.hasRecentAssistant,
  );
}

export function buildTerminalRuntimePatch(error: string | null = null): Partial<SessionRuntimeState> {
  return {
    sending: false,
    activeRunId: null,
    sendAcceptance: null,
    streamingText: '',
    streamingMessage: null,
    streamingMessages: [],
    streamingToolResults: [],
    streamingTools: [],
    pendingFinal: false,
    lastUserMessageAt: null,
    optimisticUserMessage: null,
    pendingToolImages: [],
    error,
  };
}
