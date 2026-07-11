/**
 * Run completion helpers for chat streaming.
 * Single source of truth for Claude/OpenClaw terminal vs fragment detection.
 */
import { hasNonToolAssistantContent } from './helpers';
import type { RawMessage } from './types';

export function hasPendingToolUse(message: RawMessage | undefined): boolean {
  if (!message) return false;

  const msg = message as unknown as Record<string, unknown>;
  const stopReason = msg.stopReason ?? msg.stop_reason;
  if (String(stopReason ?? '').toLowerCase() === 'tooluse') return true;

  const content = message.content;
  if (Array.isArray(content)) {
    if ((content as Array<{ type?: string }>).some((block) => block.type === 'tool_use' || block.type === 'toolCall')) {
      return true;
    }
  }

  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

export function isClaudeRuntimeResultDone(runtimeResult: unknown): boolean {
  if (!runtimeResult || typeof runtimeResult !== 'object') return false;
  const result = runtimeResult as Record<string, unknown>;
  if (result.type !== 'result') return false;
  if (result.isError === true) return true;
  const subtype = typeof result.subtype === 'string' ? result.subtype : '';
  return subtype === '' || subtype === 'success' || subtype.startsWith('error_');
}

export function isAgentCompletedEventPhase(phase: unknown): boolean {
  const eventPhase = String(phase ?? '').toLowerCase();
  return eventPhase === 'completed'
    || eventPhase === 'done'
    || eventPhase === 'finished'
    || eventPhase === 'end';
}

function isAgenticEngine(engineType: string | undefined): boolean {
  return engineType === 'claude' || engineType === 'openclaw';
}

export function resolveAssistantFinalTerminalState(
  engineType: string | undefined,
  sending: boolean,
  eventPhase: unknown,
  finalMsg: RawMessage,
): { isAgenticRunFragment: boolean; isTerminalOutput: boolean } {
  // OpenClaw 整轮 terminal 只认 agent.completed（finalizeOpenClawRunAfterAgentCompleted）；
  // 中间 assistant final 即使带正文也只是 fragment，不能清 sending / 不能 defer 成完成态。
  if (engineType === 'openclaw' && sending) {
    return { isAgenticRunFragment: true, isTerminalOutput: false };
  }

  // Multi-step agentic runs emit many assistant 'final' events before the run
  // truly ends. While sending=true and agent.completed has not arrived, treat
  // these as non-terminal for BOTH Claude and OpenClaw.
  const isAgenticRunFragment =
    isAgenticEngine(engineType)
    && sending
    && !isAgentCompletedEventPhase(eventPhase);
  const hasOutput = hasNonToolAssistantContent(finalMsg);
  const isTerminalOutput =
    hasOutput
    && !hasPendingToolUse(finalMsg)
    && !isAgenticRunFragment;
  return { isAgenticRunFragment, isTerminalOutput };
}

export function shouldAutoCompleteClaudeFromHistory(
  engineType: string | undefined,
  runtimeState: { isRunning?: boolean; runtimeResult?: unknown } | undefined,
  hasRecentAssistant: boolean,
): boolean {
  if (engineType !== 'claude' || !hasRecentAssistant) return false;
  return runtimeState?.isRunning === false
    && isClaudeRuntimeResultDone(runtimeState.runtimeResult);
}
