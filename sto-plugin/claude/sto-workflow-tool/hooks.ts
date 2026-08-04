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
  "STO 工作流工具使用规则：",
  "",
  "【意图分流】",
  "- 用户仅查询、浏览或比较工作流模板时，只调用 search_workflow_templates，并向用户说明匹配结果；不要自动获取参数表单。",
  "- 用户明确要创建工作流时，先调用 search_workflow_templates。只有存在唯一且明确的匹配模板时，才使用其 templateId 调用 get_workflow_schema。",
  "- 搜索结果为空时，请用户补充业务需求；存在多个合理匹配时，请用户选择。禁止未经确认直接选择第一个结果。",
  "",
  "【创建工作流】",
  "- get_workflow_schema 成功后，客户端会渲染参数表单。本轮立即停止调用工作流工具，只告知用户检查并提交表单；同一轮禁止调用 create_workflow。",
  "- 只有收到用户或客户端明确提交并确认的表单值后，才能调用 create_workflow。必须原样使用本次表单对应的 templateId、schemaHash 和 values。",
  "- 禁止猜测、补写或擅自修改业务参数；缺少必填值时不得创建，也不得复用其他模板或旧表单的参数。",
  "- create_workflow 成功只表示已创建工作流实例，并不表示已经执行。保存返回的 workflowId；只有用户明确要求运行时才继续执行。",
  "",
  "【执行与查询】",
  "- execute_workflow 只接收已知的 workflowId，用于启动或重新运行工作流实例；不得把 templateId 或 runId 当作 workflowId。",
  "- execute_workflow 成功后保存其返回的 runId；使用 get_workflow_status(runId) 查询本次运行的进度和结果。",
  "- 需要等待最终结果时，可以查询至 completed、failed 或 cancelled 等终态，但禁止无间隔地高频轮询。",
  "- 工具超时或状态暂时未知时，不得擅自再次调用 execute_workflow，以免重复执行业务；应优先继续使用原 runId 查询状态。",
  "",
  "【工具边界与失败处理】",
  "- 创建、搜索、执行和查询 STO 工作流只能使用上述 STO 工作流工具。禁止通过 Bash、exec、sai-cli、直接 HTTP 请求或手工读写文件操作工作流。",
  "- 工作流工具参数错误时，根据错误信息修正；鉴权、网络或服务错误无法安全修正时，直接报告错误。禁止改用 shell、其他 CLI 或脚本绕过工作流工具。",
  "- 上述限制仅针对工作流本身，不限制后续通知等非工作流动作。普通的非工作流 sai-cli 命令允许执行。",
  "- `dws chat message send` 是发送结果通知，不是操作工作流；允许直接调用，即使其 --title 或 --text 中含有 workflow、工作流等字样，也不得因此放弃发送或改用其他方式。",
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

  // DingTalk delivery is a follow-up notification, not a workflow operation.
  // Its title/body may legitimately contain "workflow" or "工作流".
  if (/^dws\s+chat\s+message\s+send\b/.test(normalized)) return false;

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
