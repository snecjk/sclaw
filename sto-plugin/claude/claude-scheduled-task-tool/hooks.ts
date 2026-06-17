import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';

const SCHEDULED_TASK_TOOL_NAMES = new Set([
  'create_claude_scheduled_task',
  'list_claude_scheduled_tasks',
  'get_claude_scheduled_task',
  'update_claude_scheduled_task',
  'delete_claude_scheduled_task',
  'trigger_claude_scheduled_task',
]);

function isLegacyCronToolName(toolName: string): boolean {
  return /^Cron[A-Z]/.test(toolName) || toolName === 'Cron';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
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

function isScheduledTaskShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;

  return /\bcron\b|\bschedule(?:d)?\s+task\b|定时任务|计划任务/.test(normalized)
    || /\bclaude-scheduled-task\b/.test(normalized);
}

export function createScheduledTaskGuard(): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (!isPreToolUse(input)) return allow();

    const toolName = normalizeToolName(input.tool_name);
    const toolInput = asRecord(input.tool_input);

    if (isLegacyCronToolName(toolName)) {
      return deny(
        'Legacy Cron tools are disabled for Claude conversations. Use the claude-scheduled-task-tool MCP tools instead.',
      );
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

export function buildScheduledTaskHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        hooks: [createScheduledTaskGuard()],
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
