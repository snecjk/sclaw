# STO 内置 Tools 平台架构

> **状态**：目标架构（演进中）  
> **首个落地域**：工作流（见 [workflow-tool-architecture.md](./workflow-tool-architecture.md) 附录）  
> **关联 OpenSpec**：`openspec/changes/workflow-natural-language-agent/`（一期决策将被本方案逐步取代，见 §8）

---

## 1. 背景与目标

### 1.1 要解决的问题

StoClaw 中存在多类「模型应调用的企业 API 能力」（工作流、定时任务、后续业务域）。当前实现分散：

- 部分能力由 **前端 Renderer 直接调 HTTP**（工作流）
- 部分能力已有 **OpenClaw 内置 Plugin Tool**（定时任务 `create_scheduled_task`）
- 消息落到模型且 **没有对应 tool** 时，模型会误用 `exec` / `sai-cli` 猜测命令

用户预期：**内置 tools = Gateway 进程里的 `api.registerTool`，直接调 STO HTTP API；不走 MCP，不走 sai-cli。**

### 1.2 平台目标

| 目标 | 说明 |
|------|------|
| **统一注册** | 新内置 tool 按清单接入，少改 `openclaw-auth` / bundle 脚本 |
| **统一 HTTP** | SSO、`baseUrl`、`stoToken`、`X-Trace-Id`、错误 unwrap 一处实现 |
| **统一响应信封** | `details.type` 驱动前端 UI，不靠猜意图 |
| **统一前端监听** | 一个 Hub + 多 Handler，替代各域独立 listener |
| **与现有 UI 共存** | `parameter_form`、`workflow_card`、Tracker 继续由 Renderer 渲染 |

### 1.3 明确不做

- ❌ **MCP 协议**：内置能力不走 MCP Server
- ❌ **sai-cli 代理工作流 API**：sai-cli 仍是业务数据查询技能，不是工作流执行通道
- ❌ **前端猜意图直调 API 作为长期方案**：迁移期保留，最终收敛到「模型选 tool → 插件调 API → 前端跟 UI」

---

## 2. 当前生产代码图谱（2026-06 终态）

以下为 **正在使用** 的代码路径（NL 前端抢先拦截已移除，见 §7 PR-3/4）。

### 2.1 聊天发送入口

所有页面经 `dispatchChatSend` 统一分发：

| 入口 | 文件 |
|------|------|
| Chat 页 | `src/pages/Chat/index.tsx` |
| Home 枢纽 | `src/pages/Home/use-home-chat-entry-send.ts` |
| 任务子项 | `src/pages/TaskDetail/use-sto-task-subitem-chat-send.ts` |

`dispatchChatSend`（`src/hooks/dispatch-chat-send.ts`）**当前顺序**：

```
1. workflowId（/ 或选择器）     → sendWithWorkflow → 注入 workflow-context → Gateway
2. tryResolvePendingWorkflow    → 仅 parameter_form 确认 / 取消（前端直调 create/start）
3. question:split + sendMessage → 普通 Gateway 聊天（模型 + builtin tools）
```

创建 / 搜索 / 重执行：**不再**由前端关键词拦截；由模型调用 `sto-workflow-tool` 内置 tools。

### 2.2 工作流（模型 Tool + 前端 UI）

| 模块 | 文件 | 职责 |
|------|------|------|
| **插件** | `sto-plugin/sto-workflow-tool/` | 5 个 workflow tools（search / schema / create / execute / status） |
| **平台 SDK** | `sto-plugin/sto-toolkit/` | HTTP、信封、`defineStoTool` |
| **Tool 监听** | `src/hooks/use-builtin-tool-listener.ts` | `toolresult` → schema / created / execution_started Handler |
| API 客户端 | `src/lib/workflow-api.ts` | Renderer 侧 API（表单提交、Tracker 对齐） |
| 发送编排 | `src/hooks/use-workflow-send.ts` | `sendWithWorkflow`、`createAndStartWorkflowDirect`（`/` 与表单） |
| 会话 hint | `src/lib/workflow-session-hint.ts` | 重执行意图时注入 `workflowId` 摘要给模型 |
| 表单态辅助 | `src/hooks/use-workflow-intent.ts` | **仅**取消/确认/重执行 hint 判断（无 NL 路由） |
| 上下文注入 | `src/lib/workflow-context.ts` | `/` 入口隐藏 schema 块；禁止 sai-cli |
| 启动 UI | `src/lib/workflow-run-started.ts` | tool 或表单启动后：卡片 + Tracker + memory |
| 长记忆 | `src/stores/workflow-memory.ts` | localStorage `workflowId` / 参数 / 执行记录 |
| 参数表单 | `src/stores/chat.ts` → `maybeAppendWorkflowParameterForm` | 模型回复后追加 `parameter_form` |
| 状态追踪 | `electron/main/services/workflow-execution-tracker.ts` | IPC 轮询（2s）更新卡片 |
| 完成总结 | `src/lib/workflow-completion-delivery.ts` | 结构化 user message → 模型总结 |
| UI | `src/components/workflow/WorkflowCard.tsx`、`parameter-form/` | 卡片与表单 |

**已移除**：`tryStartRememberedWorkflowSend`、`tryNaturalLanguageWorkflowSend`、`pendingTemplateSelection`、静态 `appendLocalConversationTurn` 工作流回复。

### 2.3 定时任务（内置 Tool — 参考实现）

| 模块 | 文件 | 职责 |
|------|------|------|
| 插件 | `sto-plugin/sto-scheduled-task-tool/index.ts` | `api.registerTool({ id: 'create_scheduled_task' })` |
| 前端监听 | `src/hooks/use-scheduled-task-tool-listener.ts` | 扫描 `toolresult`，`type === scheduled_task_confirmation'` → 弹窗 |
| 使用处 | `src/pages/Home/index.tsx` | `useScheduledTaskToolListener()` |

**注意**：`electron/utils/openclaw-auth.ts` 中 `create_scheduled_task` 在 `tools.deny` 里，且 `plugins.entries['sto-scheduled-task-tool']` 被删除——云端定时任务本版本未上线，但 **模式可复用**。

### 2.4 其他 STO 插件（非 Tool 域）

| 插件 | 作用 |
|------|------|
| `sto-dynamic-agent-route` | `before_model_resolve` 路由 + `wrapStreamFn` 注入头 |
| `sto-agent-telemetry` | 工具/模型调用遥测 |
| `sto-skill-call-monitor` | 技能使用上报 |
| `sto-dingtalk-send-guard` | 钉钉发送守卫 |

### 2.5 模型侧约束文案

`resources/context/TOOLS.stoclaw.md`：禁止升级类 exec；钉钉 dws 规则。  
`src/lib/workflow-context.ts`：工作流参数引导时禁止 sai-cli/exec。

---

## 3. 目标架构（To-Be）

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Renderer                                                                 │
│  dispatchChatSend ──► sendMessage(Gateway)  【主路径：模型决策】           │
│       │                              ▲                                    │
│       │ 迁移期保留                      │ toolresult                        │
│       ▼                              │                                    │
│  use-workflow-send (逐步收窄)         │                                    │
│       │                              │                                    │
│  use-builtin-tool-listener ◄─────────┘                                    │
│    ├─ workflow_execution_started → workflow_card + Tracker               │
│    ├─ workflow_schema_ready      → parameter_form                        │
│    └─ scheduled_task_confirmation → TaskCreateModal（已有）               │
└──────────────────────────────────────────────────────────────────────────┘
                                    ↕ Gateway tool_call / tool_result
┌──────────────────────────────────────────────────────────────────────────┐
│  sto-plugin/                                                              │
│  sto-toolkit/          ← 共享：HTTP、信封、defineStoTool                   │
│  sto-workflow-tool/    ← 领域：6 个 workflow tools                       │
│  sto-scheduled-task-tool/ ← 迁入 toolkit（可选）                          │
│  sto-builtin-tools.manifest.json ← 清单驱动 enable/deny                  │
└──────────────────────────────────────────────────────────────────────────┘
                                    ↕ fetch + stoToken
┌──────────────────────────────────────────────────────────────────────────┐
│  STO Cloud  /agent/v1/...                                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

**职责划分**：

| 层 | 做什么 | 不做什么 |
|----|--------|----------|
| **模型** | 理解意图、选 tool、组织自然语言 | 不拼 HTTP、不调 sai-cli 跑工作流 |
| **插件 execute** | 调 STO API、返回结构化 JSON | 不渲染 React、不写 localStorage |
| **前端 Handler** | 表单/卡片/弹窗、Tracker、memory | 不替代模型做意图路由（迁移完成后） |

---

## 4. 平台契约

### 4.1 Tool 响应信封

所有内置 tool 的 `execute` 必须返回统一结构（`sto-toolkit` 提供 helper）：

```typescript
interface StoToolEnvelope<T = unknown> {
  type: string;           // 前端分发键，稳定、文档化
  success: boolean;
  domain: string;       // 如 'workflow' | 'scheduled_task'
  message?: string;     // 给人看的简短说明
  data?: T;
  error?: { code: string; message: string };
}

// registerTool 返回值
return {
  content: [{ type: 'text', text: JSON.stringify(envelope) }],
  details: envelope,
};
```

### 4.2 已规划 `type` 枚举（可扩展）

| type | domain | 前端 Handler | 说明 |
|------|--------|--------------|------|
| `workflow_templates_found` | workflow | 可选列表 UI | `search_workflow_templates` |
| `workflow_schema_ready` | workflow | `parameter_form` | `get_workflow_schema` |
| `workflow_created` | workflow | 更新 pending/memory | `create_workflow` |
| `workflow_execution_started` | workflow | `workflow_card` + Tracker | `execute_workflow` |
| `workflow_run_status` | workflow | 更新 card 状态 | `get_workflow_status` |
| `scheduled_task_confirmation` | scheduled_task | TaskCreateModal | **已上线模式** |
| `sto_tool_error` | * | toast / 模型可读错误 | 通用失败 |

### 4.3 前端 Hub

目标文件：`src/hooks/use-builtin-tool-listener.ts`（待建）

```typescript
const BUILTIN_TOOL_HANDLERS: Record<string, ToolResultHandler> = {
  workflow_execution_started: handleWorkflowExecutionStarted,
  workflow_schema_ready: handleWorkflowSchemaReady,
  scheduled_task_confirmation: handleScheduledTaskConfirmation, // 从现有 hook 迁入
};
```

扫描规则（与 `use-scheduled-task-tool-listener.ts` 一致）：

- `message.role === 'toolresult'`
- 按 `toolName` + 解析 `content` 中 JSON 的 `type`
- 去重：`processedMsgIdsRef`

**复用现有实现**：

- `appendWorkflowStartedLocalTurn`（`workflow-local-turn.ts`）
- `saveWorkflowRecord` / `saveWorkflowExecution`（`workflow-memory.ts`）
- `invokeIpc('workflow:startTracking')`（与 `use-workflow-send.ts` 相同）
- `buildWorkflowFormConfig` + `registerParameterFormHandler`

### 4.4 插件清单

目标文件：`sto-plugin/sto-builtin-tools.manifest.json`（待建）

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "sto-workflow-tool",
      "localDir": "sto-workflow-tool",
      "enabled": true,
      "config": { "ssoAuthPath": "~/.stoclaw/openclaw/sso-auth.json" },
      "tools": [
        "search_workflow_templates",
        "get_workflow_schema",
        "create_workflow",
        "execute_workflow",
        "get_workflow_status"
      ]
    },
    {
      "id": "sto-scheduled-task-tool",
      "localDir": "sto-scheduled-task-tool",
      "enabled": false,
      "tools": ["create_scheduled_task"]
    }
  ]
}
```

`syncStoPluginsToOpenClaw` / `bundle-openclaw-plugins.mjs` 未来从 manifest 读取，减少硬编码列表。

---

## 5. sto-toolkit 共享 SDK（待实现）

目录：`sto-plugin/sto-toolkit/`

| 模块 | 职责 |
|------|------|
| `http-client.ts` | `resolveBaseUrl(pluginConfig)`、`readSsoAuth`、`stoFetch(path, init)` |
| `envelope.ts` | `stoToolSuccess` / `stoToolError` |
| `define-sto-tool.ts` | 包装 `api.registerTool`，统一日志与错误 |
| `types.ts` | `StoToolEnvelope`、插件 config 类型 |

**HTTP 对齐**：与 `src/lib/workflow-api.ts` 相同端点与 header（`stoToken`、`X-Trace-Id`）。插件运行在 Gateway 进程，**不能** import Renderer 的 `@/lib/host-api`；逻辑应对照 `workflow-api.ts` 复制/共享类型定义。

**SSO 路径**：与 `sto-dynamic-agent-route` 一致，默认 `~/.stoclaw/openclaw/sso-auth.json`。

---

## 6. 工作流域工具（首个消费者）

详细参数与 API 映射见 [workflow-tool-architecture.md §3](./workflow-tool-architecture.md#3-工作流工具接口附录)。

| Tool ID | HTTP | 迁移后谁调用 |
|---------|------|--------------|
| `search_workflow_templates` | `POST .../workflow-templates/search` | 模型 |
| `get_workflow_schema` | `GET .../startup-schema` | 模型 |
| `create_workflow` | `POST .../workflows` | 模型 |
| `execute_workflow` | `POST .../workflows/{id}/start` | 模型（含「重新执行」） |
| `get_workflow_status` | `GET .../runs/{id}` | 模型 |
| `subscribe_workflow_status` | `GET .../runs/{id}/stream` | 插件或 Main Tracker（P2） |

### 6.1 与现有 UI 的衔接

| 现有能力 | 迁移后触发方式 |
|----------|----------------|
| `parameter_form` | Handler 收到 `workflow_schema_ready` 或保留 `maybeAppendWorkflowParameterForm`（上下文注入路径） |
| `workflow_card` | Handler 收到 `workflow_execution_started`，调用 `appendWorkflowStartedLocalTurn` |
| Tracker | Handler 内 `invokeIpc('workflow:startTracking', { runId, workflowId, sessionKey, agentId })` |
| 完成总结 | 保持 `workflow-completion-delivery.ts`（Tracker 终端态 → 结构化 user message） |
| `/` 选择模板 | **保留** `dispatchChatSend` 中 `workflowId` 分支 → `sendWithWorkflow`（快捷入口） |

### 6.2 模型提示词补充（待加）

在 `before_prompt_build` 或 `TOOLS.stoclaw.md` 增加：

- 工作流创建/执行/重跑：**必须**使用 `search_workflow_templates` / `execute_workflow` 等内置 tool
- **禁止**用 `exec`、`sai-cli` 或虚构的 `openclaw workflow` 命令
- 会话内已有 `workflowId` 时优先 `execute_workflow`

可选：插件在 `before_prompt_build` 注入当前会话 `workflow-memory` 摘要（`workflowId`、`templateName`、`collectedInputs`）。

---

## 7. 迁移路线

> **可执行 PR 拆分**（文件级、验收用例、依赖顺序）见 **[workflow-nl-to-tool-migration.md](./workflow-nl-to-tool-migration.md)**。

### Phase 0 — 文档与契约

- [x] 本文档
- [x] 升级 `workflow-tool-architecture.md`
- [x] OpenSpec `sto-builtin-tools-platform`
- [x] PR 拆分文档 `workflow-nl-to-tool-migration.md`

### Phase 1 — 最小闭环（工作流执行）— 已完成

- [x] `sto-toolkit` 骨架
- [x] `sto-workflow-tool`：`execute_workflow`、`search_workflow_templates`
- [x] `syncStoPluginsToOpenClaw` / `plugin-install`
- [x] **PR-1** `bundle-openclaw-plugins.mjs` / `after-pack.cjs` 含 `sto-workflow-tool`
- [x] `use-builtin-tool-listener` + `workflow_execution_started`
- [x] `TOOLS.stoclaw.md` / `before_prompt_build`

### Phase 2 — 去掉前端抢先拦截 — 已完成

- [x] **PR-2** Skill / `workflow-session-hint` 会话上下文
- [x] **PR-3** 删除 `tryStartRememberedWorkflowSend`
- [x] **PR-4** 删除 `tryNaturalLanguageWorkflowSend`
- [x] **PR-6** 收窄 `tryResolvePendingWorkflow`（仅表单确认/取消）

### Phase 3 — 全量 workflow tools — 已完成（SSE P2 待定）

- [x] **PR-5** `get_workflow_schema`、`create_workflow`、`get_workflow_status` + Handler
- [ ] `subscribe_workflow_status` 与 Tracker 整合（P2）
- [ ] manifest 驱动 bundle 列表（P2，当前脚本已硬编码 local 插件）

### Phase 4 — 清理与其他域

- [x] **PR-7** 文档对齐（`sto-builtin-tools-platform.md`、`workflow-tool-architecture.md`、`WORKFLOW-IMPLEMENTATION-SCHEME.md §14.9`、`workflow-nl-to-tool-migration.md`）
- [ ] **PR-7** 手工验收 + comms 回归（发版前）
- [ ] `sto-scheduled-task-tool` 迁入 toolkit
- [ ] 新业务能力按 §9 Checklist 接入

**迁移原则（已落地）**：`workflow-api.ts` 保留；Handler / 表单委托同一 API 语义；`sendWithWorkflow`（`/` 入口）保留至终态。

---

## 8. 与 OpenSpec 一期决策的关系

`openspec/changes/workflow-natural-language-agent/design.md` 决策：

| 原决策 | 本方案 |
|--------|--------|
| 前端直调 API，不用 Plugin Tool | **演进为**：API 由 Plugin Tool 调；前端只跟 UI |
| 上下文注入代替 Tool Calling | **并存**：参数引导仍可用 `workflow-context.ts`；执行类动作走 tool |
| `parameter_form` 前端渲染 | **不变** |
| 完成总结用结构化 user message | **不变** |
| localStorage 长记忆 | **不变**；Handler 写入 `workflow-memory.ts` |

一期 `sendWithWorkflow` / `parameter_form` 保留；**前端 NL 意图拦截已移除**（2026-06）。

---

## 9. 新内置 Tool 接入 Checklist

1. 在 `sto-plugin/sto-xxx-tool/` 用 `defineStoTool` 注册，HTTP 走 `sto-toolkit`
2. 在 `sto-builtin-tools.manifest.json` 声明 `id`、`tools`、`enabled`
3. 分配唯一 `StoToolEnvelope.type`，写入本文档 §4.2 表
4. 在 `use-builtin-tool-listener` 注册 Handler（或扩展现有 UI）
5. 更新 `resources/context/TOOLS.stoclaw.md` 模型约束
6. 插件单测 + Handler 单测
7. 若涉及通信路径：`pnpm run comms:replay` + `comms:compare`

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 双路径并行（前端 + tool）重复执行 | Phase 2 显式收窄；tool 成功则前端拦截 return false |
| 插件与 Renderer API 行为不一致 | Handler 复用 `workflow-api.ts`；类型共享 `src/types/workflow.ts` |
| `tools.deny` 误禁新 tool | manifest 统一生成 allow/deny |
| 模型仍调 sai-cli | prompt + `workflow-context` 同类禁止条款 |

---

## 11. 验收标准（平台级）

- [ ] 用户说「重新执行」且会话有 `workflowId` 时，模型调用 `execute_workflow`，不出现 sai-cli/exec（**需 UI 手工验证**）
- [x] 新 tool 接入不改 `dispatch-chat-send` 主流程（只加 Handler）
- [x] `pnpm test` 插件单测通过
- [x] 文档与 `sto-builtin-tools.manifest.json` tool 列表一致

---

## 12. 相关文件索引

| 类别 | 路径 |
|------|------|
| 聊天分发 | `src/hooks/dispatch-chat-send.ts` |
| 工作流发送（迁移源） | `src/hooks/use-workflow-send.ts` |
| 工作流 API（Renderer） | `src/lib/workflow-api.ts` |
| 上下文注入 | `src/lib/workflow-context.ts` |
| 定时任务监听（Hub 样板） | `src/hooks/use-scheduled-task-tool-listener.ts` |
| 插件注册 | `electron/utils/openclaw-auth.ts`、`scripts/bundle-openclaw-plugins.mjs` |
| 定时任务插件（样板） | `sto-plugin/sto-scheduled-task-tool/` |
| 工作流 OpenSpec | `openspec/changes/workflow-natural-language-agent/` |
| 实现方案（历史） | `docs/WORKFLOW-IMPLEMENTATION-SCHEME.md` |
