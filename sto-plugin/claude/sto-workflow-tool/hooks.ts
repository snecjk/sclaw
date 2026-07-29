/**
 * Claude Agent SDK hooks for STO workflow tools.
 */
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

export const WORKFLOW_SYSTEM_PROMPT = [
  "STO workflow tools:",
  "- For workflow creation/discovery, call search_workflow_templates, then get_workflow_schema, then stop.",
  "- After get_workflow_schema succeeds, the client renders a parameter form. Ask the user to review and submit it. Do not invent parameter values.",
  "- Use create_workflow only when the values were explicitly confirmed by the user/client.",
  "- Use execute_workflow to start or rerun a known workflowId.",
  "- Use get_workflow_status to check a known runId.",
  "- Do not use Bash, exec, or filesystem reads to operate STO workflows. Regular non-workflow sai-cli commands are allowed.",
  "- Important (scheduled-task execution context): if the context/message contains StoClaw DingTalk Recipients JSON, after the workflow status becomes completed, you MUST take the final output and immediately call `dws chat message send` to send it to those recipients. Never just reply \"completed\" without sending the DingTalk message.",
].join("\n");

const WORKFLOW_TOOL_NAMES = new Set([
  "search_workflow_templates",
  "get_workflow_schema",
  "create_workflow",
  "execute_workflow",
  "get_workflow_status",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeToolName(toolName: string): string {
  const parts = toolName.split("__");
  return parts[parts.length - 1] || toolName;
}

function isPreToolUse(input: HookInput): input is PreToolUseHookInput {
  return input.hook_event_name === "PreToolUse";
}

function isPostToolUse(input: HookInput): input is PostToolUseHookInput {
  return input.hook_event_name === "PostToolUse";
}

function allow(): HookJSONOutput {
  return {};
}

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function isWorkflowShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;

  return /\bworkflow\b|工作流/.test(normalized)
    || /\bsai(?:-cli|_cli)?\s+(workflow|workflows)\b/.test(normalized);
}

export function createWorkflowGuard(): HookCallback {
  let schemaFetchedInTurn = false;

  return async (input): Promise<HookJSONOutput> => {
    if (!isPreToolUse(input)) return allow();

    const toolName = normalizeToolName(input.tool_name);
    const toolInput = asRecord(input.tool_input);

    if (toolName === "get_workflow_schema") {
      schemaFetchedInTurn = true;
      return allow();
    }

    if (toolName === "create_workflow" && schemaFetchedInTurn) {
      return deny(
        "get_workflow_schema already returned the startup schema. The client must collect and confirm parameters before create_workflow can be used.",
      );
    }

    if (toolName === "Bash") {
      const command = String(toolInput.command ?? "");
      if (isWorkflowShellCommand(command)) {
        return deny(
          "Do not operate STO workflows through shell commands. Use the STO workflow MCP tools instead.",
        );
      }
    }

    return allow();
  };
}

export function createWorkflowTelemetryHook(
  log: (entry: {
    tool: string;
    status: "success" | "error";
    durationMs?: number;
    timestamp: number;
  }) => void = console.log,
): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (!isPostToolUse(input)) return allow();

    const toolName = normalizeToolName(input.tool_name);
    if (!WORKFLOW_TOOL_NAMES.has(toolName)) return allow();

    const response = input.tool_response;
    const isError =
      response != null
      && typeof response === "object"
      && Boolean((response as Record<string, unknown>).isError);

    log({
      tool: toolName,
      status: isError ? "error" : "success",
      durationMs: input.duration_ms,
      timestamp: Date.now(),
    });

    return allow();
  };
}

export function buildWorkflowHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        hooks: [createWorkflowGuard()],
      },
    ],
    PostToolUse: [
      {
        hooks: [createWorkflowTelemetryHook()],
      },
    ],
  };
}

export type { HookCallback, HookCallbackMatcher, HookJSONOutput };
