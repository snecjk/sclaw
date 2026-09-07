/**
 * Claude Agent SDK hooks：把 shared/claude-loop-guard 的空转判定挂到 PreToolUse。
 *
 * 每个 sessionKey 一个 tracker；新的用户轮次（UserPromptSubmit）和回合结束（Stop）
 * 都会重置，避免跨轮次误伤。
 */
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import {
  buildToolCallSignature,
  buildToolRepeatBlockReason,
  createToolRepeatTracker,
  type ToolRepeatTracker,
} from '../../shared/claude-loop-guard';
import { logger } from '../utils/logger';
import { getChatRuntimeRepository } from '../db/repositories/chat-runtime-repository';

const trackers = new Map<string, ToolRepeatTracker>();

function trackerFor(sessionKey: string): ToolRepeatTracker {
  const existing = trackers.get(sessionKey);
  if (existing) return existing;
  const created = createToolRepeatTracker();
  trackers.set(sessionKey, created);
  return created;
}

function isPreToolUse(input: HookInput): input is PreToolUseHookInput {
  return input.hook_event_name === 'PreToolUse';
}

function allow(): HookJSONOutput {
  return {};
}

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

export function resetClaudeLoopGuard(sessionKey: string): void {
  trackers.get(sessionKey)?.reset();
}

export function buildClaudeLoopGuardHooks(
  sessionKey: string,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const guard: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name === 'UserPromptSubmit' || input.hook_event_name === 'Stop') {
      resetClaudeLoopGuard(sessionKey);
      return allow();
    }
    if (!isPreToolUse(input)) return allow();

    const signature = buildToolCallSignature(input.tool_name, input.tool_input);
    const decision = trackerFor(sessionKey).record(signature);
    if (!decision.blocked) return allow();

    logger.warn('[claude-loop-guard] blocked repeated tool call', {
      sessionKey,
      toolName: input.tool_name,
      count: decision.count,
    });
    const { rememberRunInterrupt } = await import('./run-interrupt-store');
    rememberRunInterrupt(sessionKey, 'loop_guard_blocked');
    void getChatRuntimeRepository().stampInterruptCause(sessionKey, 'loop_guard_blocked').catch((error) => {
      logger.warn('[claude-loop-guard] failed to persist interrupt cause', { sessionKey, error });
    });
    return deny(buildToolRepeatBlockReason({
      toolName: input.tool_name,
      count: decision.count,
    }));
  };

  return {
    PreToolUse: [{ hooks: [guard] }],
    UserPromptSubmit: [{ hooks: [guard] }],
    Stop: [{ hooks: [guard] }],
  };
}
