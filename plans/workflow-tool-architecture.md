# 工作流内置 Tools 方案

> **上级文档**：[sto-builtin-tools-platform.md](./sto-builtin-tools-platform.md)（STO 内置 Tools 通用平台）  
> **状态**：工作流域附录 + 实施清单  
> **最后对齐代码**：2026-06（与 `dispatch-chat-send`、`use-workflow-send`、`workflow-api` 一致）

本文档描述**工作流**在通用内置 Tools 平台下的工具定义与迁移要点。平台层契约（响应信封、前端 Hub、manifest）见上级文档。

---

## 1. 用户预期流程

```
用户自然语言 → 模型调用 search_workflow_templates
            → 模型调用 get_workflow_schema
            → 前端渲染 parameter_form（Handler 或现有 maybeAppendWorkflowParameterForm）
            → 模型/用户确认参数 → 模型调用 create_workflow + execute_workflow
            → 前端 workflow_card + Tracker
            → 完成 → workflow-completion-delivery → 模型总结
```

**重新执行**：模型调用 `execute_workflow({ workflowId, inputs })`，禁止 `exec` / `sai-cli`。

---

## 2. 当前实现（2026-06 终态）

### 2.1 发送链路

`dispatchChatSend`（`src/hooks/dispatch-chat-send.ts`）：

| 步骤 | 函数 | 行为 |
|------|------|------|
| 1 | `sendWithWorkflow` | `/` 或选择器传入 `workflowId` → 拉 schema → 注入 `workflow-context` → Gateway |
| 2 | `tryResolvePendingWorkflow` | **仅** parameter_form 确认/取消 → `createAndStartWorkflowDirect` |
| 3 | `sendMessage` | 普通聊天；模型通过 `sto-workflow-tool` 调 search / schema / create / execute |

自然语言「创建 xxx 工作流」「再跑一遍」：**不经前端拦截**，由模型 + Skill + builtin tools 处理。

调用方：`Chat/index.tsx`、`Home/use-home-chat-entry-send.ts`、`TaskDetail/use-sto-task-subitem-chat-send.ts`。

### 2.2 核心库与 UI

| 模块 | 文件 |
|------|------|
| 内置插件 | `sto-plugin/sto-workflow-tool/`、`sto-plugin/sto-toolkit/` |
| Tool 监听 | `src/hooks/use-builtin-tool-listener.ts` |
| HTTP 客户端 | `src/lib/workflow-api.ts` |
| 发送编排 | `src/hooks/use-workflow-send.ts`（`sendWithWorkflow`、表单直调） |
| 表单态 hint | `src/hooks/use-workflow-intent.ts`（取消/确认/重执行 hint，**无 NL 路由**） |
| 会话 hint | `src/lib/workflow-session-hint.ts` |
| 启动 UI | `src/lib/workflow-run-started.ts` |
| 上下文注入 | `src/lib/workflow-context.ts` |
| 记忆 | `src/stores/workflow-memory.ts` |
| 参数表单 | `src/stores/chat.ts` → `maybeAppendWorkflowParameterForm` |
| 完成总结 | `src/lib/workflow-completion-delivery.ts` |
| Tracker | `electron/main/services/workflow-execution-tracker.ts`（2s 轮询） |

### 2.3 遗留 / P2

1. **卡片 UI**：Tracker 轮询为主；`workflow-api.ts` SSE 用于 trace，尚未驱动 UI 实时推送  
2. **`subscribe_workflow_status` tool**：未实现，与 Tracker 整合为 P2  
3. **模型调 tool 可靠性**：依赖 `TOOLS.stoclaw.md` + 插件 prompt，需持续验收

---

## 3. 工作流工具接口附录

与 [Agent Workflow Client API v1](https://内部) 对齐；Renderer 参考实现：`src/lib/workflow-api.ts`。

### 3.1 工具列表

| 工具 ID | HTTP | `StoToolEnvelope.type` |
|---------|------|------------------------|
| `search_workflow_templates` | `POST /agent/v1/workflow-templates/search` | `workflow_templates_found` |
| `get_workflow_schema` | `GET /agent/v1/workflow-templates/{id}/startup-schema` | `workflow_schema_ready` |
| `create_workflow` | `POST /agent/v1/workflows` | `workflow_created` |
| `execute_workflow` | `POST /agent/v1/workflows/{id}/start` | `workflow_execution_started` |
| `get_workflow_status` | `GET /agent/v1/runs/{id}` | `workflow_run_status` |
| `subscribe_workflow_status` | `GET /agent/v1/runs/{id}/stream` | （流式，P2） |

### 3.2 参数定义

#### search_workflow_templates

```typescript
{ query: string; limit?: number }  // default limit: 10
```

#### get_workflow_schema

```typescript
{ templateId: string }
```

#### create_workflow

```typescript
{
  templateId: string;
  displayName?: string;
  startup: { schemaHash: string; values: Record<string, unknown> };
  idempotencyKey?: string;
}
```

#### execute_workflow

```typescript
{
  workflowId: string;
  inputs?: Record<string, unknown>;
  idempotencyKey?: string;
}
```

#### get_workflow_status

```typescript
{ runId: string }
```

#### subscribe_workflow_status

```typescript
{ runId: string; sessionKey: string }
```

### 3.3 Handler 与现有代码映射

| type | 前端动作 | 可委托的现有函数 |
|------|----------|------------------|
| `workflow_schema_ready` | 插入 `parameter_form` | `buildWorkflowFormConfig`、`setPendingWorkflow` |
| `workflow_execution_started` | 卡片 + Tracker | `appendWorkflowStartedLocalTurn`、`invokeIpc('workflow:startTracking')`、`saveWorkflowExecution` |
| `workflow_created` | 写 memory | `saveWorkflowRecord` |

---

## 4. 插件目录结构（目标）

```
sto-plugin/
├── sto-toolkit/                 # 平台 SDK，见 sto-builtin-tools-platform.md §5
└── sto-workflow-tool/
    ├── openclaw.plugin.json
    ├── package.json
    ├── api.ts
    ├── index.ts                 # register 6 tools
    └── tools/
        ├── search-templates.ts
        ├── get-schema.ts
        ├── create-workflow.ts
        ├── execute-workflow.ts
        ├── get-status.ts
        └── subscribe-status.ts  # P2
```

插件入口示例（使用平台 SDK）：

```typescript
import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "./api.js";
import { defineStoTool, createStoApiClient } from "../sto-toolkit/index.js";

export default definePluginEntry({
  id: "sto-workflow-tool",
  name: "申通工作流内置工具",
  register(api) {
    const client = createStoApiClient(api);

    defineStoTool(api, {
      id: "execute_workflow",
      domain: "workflow",
      resultType: "workflow_execution_started",
      description: `启动已创建的工作流实例。用户说「执行」「重新执行」「再跑一遍」且上下文有 workflowId 时必须使用本工具，禁止 exec/sai-cli。`,
      parameters: Type.Object({
        workflowId: Type.String(),
        inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
      execute: async (params) => {
        const run = await client.startWorkflow(params.workflowId, {
          inputs: params.inputs ?? {},
          idempotencyKey: `start-wf-${params.workflowId}-${Date.now()}`,
        });
        return { workflowId: params.workflowId, runId: run.runId, status: run.status };
      },
    });
    // ... 其余 tools
  },
});
```

---

## 5. 迁移期：保留与收窄

### 5.1 保留（不删）

| 能力 | 原因 |
|------|------|
| `workflow-api.ts` | Handler 与插件应对齐同一 API 语义 |
| `sendWithWorkflow` + `workflow-context.ts` | `/` 快捷入口与参数引导 |
| `parameter_form` / `WorkflowCard` / Tracker | UI 不变 |
| `workflow-memory.ts` | 长记忆 |
| `workflow-completion-delivery.ts` | 完成总结 |

### 5.2 已收窄（2026-06）

| 函数 | 状态 |
|------|------|
| `tryStartRememberedWorkflowSend` | **已删除** → 模型 `execute_workflow` |
| `tryNaturalLanguageWorkflowSend` | **已删除** → 模型 `search_workflow_templates` |
| `createAndStartWorkflowDirect` | 保留：`/` 入口与 parameter_form 提交 |
| `applyWorkflowRunStarted` | tool `execute_workflow` 与表单路径共用 |

### 5.3 快捷入口例外

用户通过 **`/` 工作流选择器** 显式选模板时，继续走 `dispatchChatSend` → `sendWithWorkflow`（不经 tool 搜索），与 OpenSpec 一致。

---

## 6. 实施阶段（已完成）

| 阶段 | 内容 | 状态 |
|------|------|------|
| W1 | `sto-toolkit` + `execute_workflow` + `search_workflow_templates` | ✅ |
| W2 | `use-builtin-tool-listener` + handlers | ✅ |
| W3 | 去掉前端抢先拦截 + prompt / session hint | ✅ |
| W4 | 其余 3 tools + manifest | ✅ |
| W5 | 文档对齐（§14.9、`sto-builtin-tools-platform.md`） | ✅ |
| P2 | `subscribe_workflow_status`、SSE 驱动 UI | 待定 |

平台级阶段见 [sto-builtin-tools-platform.md §7](./sto-builtin-tools-platform.md#7-迁移路线)。

---

## 7. 验收标准（工作流）

- [ ] 「帮我重新执行」→ 模型 `execute_workflow`，界面出现 `workflow_card`，无 sai-cli/exec（手工）
- [ ] 「创建 xxx 工作流」→ 模型 `search_workflow_templates` → schema → 表单 → create + execute（手工）
- [x] `/` 选择模板仍走 `sendWithWorkflow`
- [x] 执行完成仍触发 `deliverWorkflowCompletionIfNeeded`
- [x] 插件单测通过（`tests/unit/sto-workflow-tool-plugin.test.ts`）

---

## 8. 相关文档

- [sto-builtin-tools-platform.md](./sto-builtin-tools-platform.md) — 通用平台
- `docs/WORKFLOW-IMPLEMENTATION-SCHEME.md` — 一期实现细节
- `openspec/changes/workflow-natural-language-agent/` — 需求与一期设计
- `resources/context/TOOLS.stoclaw.md` — 模型工具红线
