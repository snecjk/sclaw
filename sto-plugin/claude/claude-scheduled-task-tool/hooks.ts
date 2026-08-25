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

/**
 * `dws chat message send` 是钉钉消息发送命令，其 `--text` / `--title` 承载的是
 * 用户消息正文（任意自然语言），不应参与"是否在用 shell 管理 Claude 定时任务"
 * 的判定——否则正文里只要出现"定时任务/cron/scheduled task"等词就会被误杀，
 * 导致合法的钉钉代发被拒（已在线上触发：群聊总结里提到"姚磊（定时任务）"）。
 */
const DWS_CHAT_MESSAGE_SEND = /dws\s+chat\s+message\s+send\b/i;

export function isScheduledTaskShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;

  // 钉钉消息发送命令一律放行：它只发钉钉，不管理 Claude 定时任务。
  if (DWS_CHAT_MESSAGE_SEND.test(command)) return false;

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
      return deny(executionBlock.reason ?? '定时任务执行过程中禁止再创建或修改定时任务。');
    }

    if (isLegacyCronToolName(toolName)) {
      return deny(
        'Claude 会话已禁用旧版 Cron 工具，请改用 claude-scheduled-task-tool 的 MCP 工具。',
      );
    }

    if (isScheduledTaskCreationToolName(toolName)) {
      return allow();
    }

    if (toolName === 'Bash') {
      const command = String(toolInput.command ?? '');
      if (isScheduledTaskShellCommand(command)) {
        return deny(
          '禁止通过 shell 或直接改文件来管理 Claude 定时任务，请改用 claude-scheduled-task-tool 的 MCP 工具。',
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
