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
  evaluateScheduledTaskCreationBlock,
  isLegacyCronToolName,
  isScheduledTaskCreationToolName,
  normalizeToolName,
} from '../../../shared/scheduled-task-instruction';

const SCHEDULED_TASK_TOOL_NAMES = new Set([
  'create_claude_scheduled_task',
  'list_claude_scheduled_tasks',
  'get_claude_scheduled_task',
  'update_claude_scheduled_task',
  'delete_claude_scheduled_task',
  'trigger_claude_scheduled_task',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
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

function isScheduledTaskShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;

  return /\bcron\b|\bschedule(?:d)?\s+task\b|定时任务|计划任务/.test(normalized)
    || /\bclaude-scheduled-task\b/.test(normalized);
}

export function createScheduledTaskGuard(sessionKey?: string): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (!isPreToolUse(input)) return allow();

    const toolName = normalizeToolName(input.tool_name);
    const toolInput = asRecord(input.tool_input);
    const resolvedSessionKey = sessionKey
      ?? (typeof input.session_id === 'string' ? input.session_id : undefined);

    const executionBlock = evaluateScheduledTaskCreationBlock({
      sessionKey: resolvedSessionKey,
      toolName,
    });
    if (executionBlock.blocked) {
      return deny(executionBlock.reason ?? 'Scheduled task creation is blocked during task execution.');
    }

    if (isLegacyCronToolName(toolName)) {
      return deny(
        'Legacy Cron tools are disabled for Claude conversations. Use the claude-scheduled-task-tool MCP tools instead.',
      );
    }

    if (isScheduledTaskCreationToolName(toolName)) {
      return allow();
    }

    if (toolName === 'Bash') {
      const command = String(toolInput.command ?? '');
      if (isScheduledTaskShellCommand(command)) {
        return deny(
          'Do not manage Claude scheduled tasks through shell commands or file edits. Use the claude-scheduled-task-tool MCP tools instead.',
        );
      }
    }

    return allow();
  };
}

export function createScheduledTaskTelemetryHook(
  log: (entry: {
    tool: string;
    status: 'success' | 'error';
    durationMs?: number;
    timestamp: number;
  }) => void = console.log,
): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (!isPostToolUse(input)) return allow();

    const toolName = normalizeToolName(input.tool_name);
    if (!SCHEDULED_TASK_TOOL_NAMES.has(toolName)) return allow();

    const response = input.tool_response;
    const isError =
      response != null
      && typeof response === 'object'
      && Boolean((response as Record<string, unknown>).isError);

    log({
      tool: toolName,
      status: isError ? 'error' : 'success',
      durationMs: input.duration_ms,
      timestamp: Date.now(),
    });

    return allow();
  };
}

export function buildScheduledTaskHooks(
  sessionKey?: string,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        hooks: [createScheduledTaskGuard(sessionKey)],
      },
    ],
    PostToolUse: [
      {
        hooks: [createScheduledTaskTelemetryHook()],
      },
    ],
  };
}

export type { HookCallback, HookCallbackMatcher, HookJSONOutput };
