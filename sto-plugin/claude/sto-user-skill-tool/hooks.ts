/**
 * Claude Agent SDK hooks: block direct skill-dir writes; schedule orphan import.
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
  evaluateUserSkillWriteGuard,
  shouldScheduleOrphanImportAfterTool,
} from '../../../shared/user-skill-write-guard';
import { scheduleOrphanSkillImport } from '../../../electron/services/skills/orphan-skill-import';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizeToolName(toolName: string): string {
  const parts = toolName.split('__');
  return parts[parts.length - 1] || toolName;
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

export function createUserSkillWriteGuard(): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (!isPreToolUse(input)) return allow();

    const decision = evaluateUserSkillWriteGuard({
      toolName: normalizeToolName(input.tool_name),
      params: asRecord(input.tool_input),
    });
    if (decision.blocked) {
      return deny(decision.reason);
    }
    return allow();
  };
}

export function createUserSkillOrphanImportHook(): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (!isPostToolUse(input)) return allow();

    if (
      shouldScheduleOrphanImportAfterTool({
        toolName: normalizeToolName(input.tool_name),
        params: asRecord(input.tool_input),
      })
    ) {
      scheduleOrphanSkillImport('claude-after-skill-path-tool');
    }
    return allow();
  };
}

export function buildUserSkillHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [{ hooks: [createUserSkillWriteGuard()] }],
    PostToolUse: [{ hooks: [createUserSkillOrphanImportHook()] }],
  };
}
