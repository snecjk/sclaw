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

/**
 * OpenClaw chat final 常是整轮合并 buffer，历史 tool_use 会一直留在 content 里。
 * 只有「末尾仍是 tool_use」或 stopReason=tooluse 才算工具未完成。
 */
export function hasTrailingPendingToolUse(message: RawMessage | undefined): boolean {
  if (!message) return false;

  const msg = message as unknown as Record<string, unknown>;
  const stopReason = String(msg.stopReason ?? msg.stop_reason ?? '').toLowerCase();
  if (stopReason === 'tooluse' || stopReason === 'tool_use') return true;
  if (
    stopReason === 'end_turn'
    || stopReason === 'endturn'
    || stopReason === 'stop'
    || stopReason === 'completed'
  ) {
    return false;
  }

  const content = message.content;
  if (Array.isArray(content)) {
    for (let i = content.length - 1; i >= 0; i -= 1) {
      const block = content[i] as { type?: string; text?: string };
      const type = block?.type;
      if (!type) continue;
      if (type === 'tool_use' || type === 'toolCall') return true;
      if (type === 'text' && typeof block.text === 'string' && block.text.trim()) return false;
      if (
        type === 'thinking'
        || type === 'tool_result'
        || type === 'toolResult'
        || type === 'image'
      ) {
        continue;
      }
    }
  }

  if (typeof message.content === 'string' && message.content.trim()) return false;
  if (typeof msg.text === 'string' && msg.text.trim()) return false;

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
  const hasOutput = hasNonToolAssistantContent(finalMsg);

  // OpenClaw: gateway 经常在 chat.state=final 后触发 agent_end，但不再下发
  // turn.completed。合并 buffer 里的历史 tool_use 不能挡住终态。
  if (engineType === 'openclaw' && sending) {
    const trailingTools = hasTrailingPendingToolUse(finalMsg);
    if (hasOutput && !trailingTools) {
      return { isAgenticRunFragment: false, isTerminalOutput: true };
    }
    return { isAgenticRunFragment: true, isTerminalOutput: false };
  }

  const pendingTools = hasPendingToolUse(finalMsg);

  // Multi-step agentic runs emit many assistant 'final' events before the run
  // truly ends. While sending=true and agent.completed has not arrived, treat
  // these as non-terminal for Claude.
  const isAgenticRunFragment =
    isAgenticEngine(engineType)
    && sending
    && !isAgentCompletedEventPhase(eventPhase);
  const isTerminalOutput =
    hasOutput
    && !pendingTools
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
