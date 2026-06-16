/**
 * sto-workflow-tool — Claude Agent SDK 入口
 *
 * ═══════════════════════════════════════════════════════════════
 *  OpenClaw 插件 vs Claude Agent SDK 架构对比
 * ═══════════════════════════════════════════════════════════════
 *
 *  ┌─ OpenClaw 插件模式 ─────────────────────────────────────────┐
 *  │                                                              │
 *  │  definePluginEntry({                                         │
 *  │    register(api) {                                           │
 *  │      defineStoTool(api, { id, parameters: TypeBox, execute })│
 *  │      api.on('before_prompt_build', () => appendSystemContext)│
 *  │      api.on('before_tool_call', () => block/blockReason)     │
 *  │    }                                                         │
 *  │  })                                                          │
 *  │                                                              │
 *  │  → 插件框架自动发现、注册、生命周期管理                          │
 *  │  → 工具通过 api.registerTool() 注入到 Gateway                  │
 *  └──────────────────────────────────────────────────────────────┘
 *
 *  ┌─ Claude Agent SDK 模式 ──────────────────────────────────────┐
 *  │                                                              │
 *  │  tool(name, description, inputSchema, handler)               │
 *  │  → createSdkMcpServer({ tools })                             │
 *  │  → query({ mcpServers, systemPrompt, hooks })                │
 *  │                                                              │
 *  │  → 调用者显式组装：工具 + 提示词 + 钩子 → 一次 query() 调用     │
 *  │  → 工具作为进程内 MCP Server 注入                               │
 *  └──────────────────────────────────────────────────────────────┘
 *
 *  关键映射：
 *    TypeBox schema       → Zod schema
 *    api.registerTool()   → createSdkMcpServer({ tools })
 *    before_prompt_build  → systemPrompt 选项
 *    before_tool_call     → PreToolUse hook
 *    after_tool_call      → PostToolUse hook
 *    Tool result          → MCP CallToolResult with STO workflow envelope text
 *    openclaw.plugin.json → 不需要（编程式配置）
 */

export {
  createWorkflowTools,
  createWorkflowMcpServer,
} from "./tools.js";

export {
  WORKFLOW_SYSTEM_PROMPT,
  createWorkflowGuard,
  createWorkflowTelemetryHook,
  buildWorkflowHooks,
} from "./hooks.js";

// ── Usage Example ──────────────────────────────────────────────────────
//
// 以下展示如何用 Claude Agent SDK 运行带工作流工具的 Agent，
// 对应 OpenClaw 版的插件自动注册 + 事件钩子。

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createWorkflowMcpServer } from "./tools.js";
import { WORKFLOW_SYSTEM_PROMPT, buildWorkflowHooks } from "./hooks.js";

/**
 * 创建一个带工作流工具的 Claude Agent 会话。
 *
 * 对比 OpenClaw 版：
 *   - OpenClaw 在 Gateway 启动时通过 openclaw.plugin.json 自动加载插件
 *   - Claude SDK 在每次 query() 调用时传入配置
 */
export async function runWorkflowAgent(
  userPrompt: string,
  config: { baseUrl: string; stoToken: string },
) {
  // 1. 创建 MCP Server（对应 OpenClaw 的 api.registerTool 批量注册）
  const workflowServer = createWorkflowMcpServer({
    baseUrl: config.baseUrl,
    stoToken: config.stoToken,
  });

  // 2. 构建 hooks（对应 OpenClaw 的 api.on('before_tool_call') + api.on('after_tool_call')）
  const hooks = buildWorkflowHooks();

  // 3. 启动 Agent 循环
  //    - systemPrompt 替代 OpenClaw 的 before_prompt_build → appendSystemContext
  //    - mcpServers 替代 OpenClaw 的插件自动发现
  //    - hooks 替代 OpenClaw 的 before_tool_call / after_tool_call
  for await (const message of query({
    prompt: userPrompt,
    options: {
      // 系统提示词（对应 WORKFLOW_TOOL_PROMPT）
      systemPrompt: WORKFLOW_SYSTEM_PROMPT,

      // 工具注册（对应 openclaw.plugin.json tools 列表）
      mcpServers: {
        "sto-workflow-tool": workflowServer,
      },

      // 工具权限控制
      allowedTools: [
        "Read",
        "Bash",
        "mcp__sto-workflow-tool__search_workflow_templates",
        "mcp__sto-workflow-tool__get_workflow_schema",
        "mcp__sto-workflow-tool__create_workflow",
        "mcp__sto-workflow-tool__execute_workflow",
        "mcp__sto-workflow-tool__get_workflow_status",
      ],

      // 生命周期钩子
      hooks,

      // 资源限制
      maxTurns: 25,
      maxBudgetUsd: 1.0,
    },
  })) {
    switch (message.type) {
      case "assistant": {
        const content = message.message.content;
        const toolCalls = content.filter(
          (c: { type: string }) => c.type === "tool_use",
        );
        if (toolCalls.length > 0) {
          console.log("[workflow-agent] calling tools:", toolCalls);
        }
        break;
      }
      case "result":
        if (message.subtype === "success") {
          console.log(`[workflow-agent] done — cost: $${message.total_cost_usd}`);
          return { sessionId: message.session_id, result: message.result };
        }
        break;
    }
  }
}
