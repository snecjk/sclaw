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
  PostToolUseHookInput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import {
  buildToolCallSignature,
  buildToolRepeatBlockReason,
  createToolRepeatTracker,
  shouldAbortRepeatedTool,
  type ToolRepeatTracker,
} from '../../shared/claude-loop-guard';
import {
  createFillProgressTracker,
  inspectFillLikeTool,
  isProgressUnlockTool,
  toolResponseLooksSuccessful,
  FILL_DONE_HINT,
  REPEAT_FILL_HINT,
  type FillProgressTracker,
} from '../../shared/browser-bridge/act-progress';
import { rememberRunInterrupt } from './run-interrupt-store';
import { logger } from '../utils/logger';
import { getChatRuntimeRepository } from '../db/repositories/chat-runtime-repository';

const trackers = new Map<string, ToolRepeatTracker>();
const fillProgressBySession = new Map<string, FillProgressTracker>();
const abortQueryBySession = new Map<string, () => void>();

/** query 注册后挂上 close 句柄；consume 结束必须卸掉，避免打到下一轮。 */
export function bindClaudeLoopGuardAbort(sessionKey: string, abort: () => void): void {
  abortQueryBySession.set(sessionKey, abort);
}

export function unbindClaudeLoopGuardAbort(sessionKey: string): void {
  abortQueryBySession.delete(sessionKey);
}

function trackerFor(sessionKey: string): ToolRepeatTracker {
  const existing = trackers.get(sessionKey);
  if (existing) return existing;
  const created = createToolRepeatTracker();
  trackers.set(sessionKey, created);
  return created;
}

function fillProgressFor(sessionKey: string): FillProgressTracker {
  const existing = fillProgressBySession.get(sessionKey);
  if (existing) return existing;
  const created = createFillProgressTracker();
  fillProgressBySession.set(sessionKey, created);
  return created;
}

function isPreToolUse(input: HookInput): input is PreToolUseHookInput {
  return input.hook_event_name === 'PreToolUse';
}

function isPostToolUse(input: HookInput): input is PostToolUseHookInput {
  return input.hook_event_name === 'PostToolUse';
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
  fillProgressBySession.get(sessionKey)?.reset();
}

function stampLoopGuardBlocked(sessionKey: string): void {
  rememberRunInterrupt(sessionKey, 'loop_guard_blocked');
  void getChatRuntimeRepository().stampInterruptCause(sessionKey, 'loop_guard_blocked').catch((error) => {
    logger.warn('[claude-loop-guard] failed to persist interrupt cause', { sessionKey, error });
  });
}

function abortQuerySoon(sessionKey: string, toolName: string, count: number, reason: string): void {
  const abort = abortQueryBySession.get(sessionKey);
  logger.warn('[claude-loop-guard] aborting query after ignored denials', {
    sessionKey,
    toolName,
    count,
    reason,
    hasAbortHandle: Boolean(abort),
  });
  if (abort) queueMicrotask(abort);
}

export function buildClaudeLoopGuardHooks(
  sessionKey: string,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const guard: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name === 'UserPromptSubmit' || input.hook_event_name === 'Stop') {
      resetClaudeLoopGuard(sessionKey);
      return allow();
    }

    if (isPostToolUse(input)) {
      const fill = inspectFillLikeTool(input.tool_name, input.tool_input);
      if (fill && toolResponseLooksSuccessful(input.tool_response)) {
        fillProgressFor(sessionKey).recordSuccess(fill.targetKey);
      }
      if (isProgressUnlockTool(input.tool_name) && toolResponseLooksSuccessful(input.tool_response)) {
        fillProgressFor(sessionKey).unlock();
      }
      if (fill && toolResponseLooksSuccessful(input.tool_response)) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: FILL_DONE_HINT,
          },
        };
      }
      return allow();
    }

    if (!isPreToolUse(input)) return allow();

    const fill = inspectFillLikeTool(input.tool_name, input.tool_input);
    const progress = fillProgressFor(sessionKey);
    if (fill && progress.shouldBlock(fill.targetKey)) {
      const blocked = progress.recordBlock();
      logger.warn('[claude-loop-guard] blocked repeat fill after success', {
        sessionKey,
        toolName: input.tool_name,
        targetKey: fill.targetKey,
        count: blocked.count,
      });
      stampLoopGuardBlocked(sessionKey);
      if (blocked.abort) {
        abortQuerySoon(sessionKey, input.tool_name, blocked.count, 'repeat_fill');
      }
      return deny(REPEAT_FILL_HINT);
    }
    if (isProgressUnlockTool(input.tool_name)) {
      progress.unlock();
    }

    const signature = buildToolCallSignature(input.tool_name, input.tool_input);
    const decision = trackerFor(sessionKey).record(signature);
    if (!decision.blocked) return allow();

    logger.warn('[claude-loop-guard] blocked repeated tool call', {
      sessionKey,
      toolName: input.tool_name,
      count: decision.count,
    });
    stampLoopGuardBlocked(sessionKey);
    if (shouldAbortRepeatedTool(decision)) {
      abortQuerySoon(sessionKey, input.tool_name, decision.count, 'repeat_signature');
    }
    return deny(buildToolRepeatBlockReason({
      toolName: input.tool_name,
      count: decision.count,
    }));
  };

  return {
    PreToolUse: [{ hooks: [guard] }],
    PostToolUse: [{ hooks: [guard] }],
    UserPromptSubmit: [{ hooks: [guard] }],
    Stop: [{ hooks: [guard] }],
  };
}
