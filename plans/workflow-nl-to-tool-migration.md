# 工作流：前端拦截 → 模型 Tool 迁移拆分

> **上级**：[sto-builtin-tools-platform.md](./sto-builtin-tools-platform.md)、[workflow-tool-architecture.md](./workflow-tool-architecture.md)  
> **目标**：去掉 `dispatchChatSend` 里的 NL 关键词抢先路由，改为 **模型 + Skill 约束 + 内置 Tool + 前端 Handler**  
> **原则**：每个 PR 可独立评审、可回滚；迁移期双轨可共存，用开关收窄

---

## 0. 现状快照（2026-06，迁移已完成）

| 模块 | 状态 | 说明 |
|------|------|------|
| `sto-toolkit` | ✅ | HTTP、信封、`defineStoTool` |
| `sto-workflow-tool` | ✅ | 5 个 tools + `before_prompt_build` |
| `sto-builtin-tools.manifest.json` | ✅ | 5 tools 声明 |
| `openclaw-auth` / `plugin-install` | ✅ | 注册 `sto-workflow-tool` |
| `use-builtin-tool-listener` | ✅ | schema / created / execution_started |
| `TOOLS.stoclaw.md` | ✅ | 正反例 + 禁止 sai-cli |
| `bundle-openclaw-plugins.mjs` | ✅ | 含 `sto-workflow-tool` |
| `dispatch-chat-send` | ✅ | 仅 `/` + 表单确认 + sendMessage |
| `use-workflow-intent.ts` | ✅ | 仅表单态 / session hint（57 行） |
| 文档 | ✅ | PR-7 已同步 |

**当前 `dispatchChatSend` 顺序（终态）：**

```
1. workflowId（/ 选择器）     → sendWithWorkflow
2. tryResolvePendingWorkflow → 表单确认/取消 only
3. sendMessage               → 模型 + builtin tools
```

---

## 1. PR 拆分总览

| PR | 标题 | 依赖 | 可并行 |
|----|------|------|--------|
| **PR-1** | 打包启用 workflow 插件 | — | ✅ |
| **PR-2** | Skill / 上下文增强 | PR-1 | ✅ |
| **PR-3** | 去掉「重执行」前端抢先 | PR-1 | ✅ |
| **PR-4** | 去掉「NL 创建工作流」前端抢先 | PR-1、PR-3 | ✅ |
| **PR-5** | 补全 create/schema/status tools + Handler | PR-1 | ✅ |
| **PR-6** | 参数确认链路收敛 | PR-5 | ✅ |
| **PR-7** | 文档对齐 | PR-3–6 | ✅（7.3/7.4 见下） |

推荐合并顺序：**PR-1 → PR-2 + PR-3（可并行）→ PR-4 → PR-5 → PR-6 → PR-7**

---

## 2. PR-1 — 打包与运行时启用插件

**目的**：确保 Gateway 进程里模型真的能调到 `search_workflow_templates` / `execute_workflow`。

### 改动范围（工程负责人）

- [ ] `scripts/bundle-openclaw-plugins.mjs` 加入 `sto-workflow-tool`（含 `sto-toolkit` sharedLibs）
- [ ] `electron-builder` / `after-pack.cjs` 若需额外拷贝，一并更新
- [ ] 确认 `tools.deny` **未** 禁用 `search_workflow_templates`、`execute_workflow`
- [ ] 本地 `pnpm dev`：Doctor / 日志可见插件 registered

### 验收

- [ ] 对话中模型可发起 `execute_workflow` tool_call（DevTools / 遥测可见）
- [ ] `workflow_execution_started` → 出现 `workflow_card` + Tracker
- [ ] 打包产物含 `extensions/sto-workflow-tool`

### 风险

- 插件未打进包 → 后续 PR 全部无效。必须先合。

---

## 3. PR-2 — Skill 约束与会话上下文

**目的**：让模型区分「建文件夹」vs「跑工作流」，减少误调 tool。

### 改动范围

| 文件 | 内容 |
|------|------|
| `resources/context/TOOLS.stoclaw.md` | 增加正反例：「创建文件/文件夹 → 不用 workflow tool」「创建对账工作流 → search_workflow_templates」 |
| `sto-workflow-tool/index.ts` `WORKFLOW_TOOL_PROMPT` | 与 TOOLS 文档对齐；强调勿对普通任务调 tool |
| **可选** `before_prompt_build` | 从 Renderer 经 IPC 注入当前会话 `workflow-memory` 摘要（`workflowId`、`templateName`、最近 `runId`） |
| **可选** `src/lib/workflow-context.ts` | 普通聊天路径不注入 workflow 块；仅 `/` 或 schema_ready 后注入 |

### 验收

- [ ] 「帮我在桌面建文件夹」→ 模型 **不** 调 `search_workflow_templates`
- [ ] 「帮我创建政策审批工作流」→ 模型调 `search_workflow_templates`
- [ ] 会话内有 `workflowId` 时，系统 prompt 可见该 ID（便于「再跑一遍」）

### 测试

- [ ] 手工对话用例 5 条（见 §8）
- [ ] 无需改 `dispatch-chat-send`

---

## 4. PR-3 — 移除 `tryStartRememberedWorkflowSend` 抢先

**目的**：修复「再运行一遍」等被前端拦截、弹静态提示或绕过模型的问题。

### 改动范围

| 文件 | 操作 |
|------|------|
| `src/hooks/dispatch-chat-send.ts` | **删除** 步骤 1（`tryStartRememberedWorkflowSend` 整块） |
| `src/hooks/use-workflow-send.ts` | `tryStartRememberedWorkflowSend` 标 `@deprecated` 或删除；逻辑由模型 `execute_workflow` + listener 承接 |
| `src/hooks/use-workflow-intent.ts` | 删除 `isWorkflowStartIntent`、`isReExecutionIntent`、`WORKFLOW_START_PATTERNS`（若无其他引用） |
| `use-builtin-tool-listener` | 确认 `applyWorkflowRunStarted` 覆盖原 `startExistingWorkflow` UI 行为 |

### 保留

- `tryResolvePendingWorkflow` 内对 **已有 `pendingWorkflow`** 的确认/取消（PR-6 再收敛）
- `resolveSessionWorkflowId` — 改由 prompt 注入给模型，而非前端解析后直调 API

### 验收

- [ ] 「没有识别全，再运行一遍」→ **直接进模型**，无工作流静态回复
- [ ] 会话有 `workflowId` + 用户「再跑一遍工作流」→ 模型 `execute_workflow` → 卡片
- [ ] 无 `workflowId` + 「再跑一遍」→ 模型正常回复，不弹「没有可运行的工作流记录」

### 回滚

- 恢复 `dispatch-chat-send` 步骤 1 即可

---

## 5. PR-4 — 移除 `tryNaturalLanguageWorkflowSend` 抢先

**目的**：「创建 xxx 工作流」由模型 `search_workflow_templates` 驱动，不再前端搜模板 + `appendLocalConversationTurn`。

### 改动范围

| 文件 | 操作 |
|------|------|
| `src/hooks/dispatch-chat-send.ts` | **删除** 步骤 3（`isNewWorkflowCreationIntent` + `tryNaturalLanguageWorkflowSend`） |
| `src/hooks/use-workflow-send.ts` | 删除或废弃 `tryNaturalLanguageWorkflowSend` |
| `src/hooks/use-workflow-intent.ts` | 仅保留 `resolveTemplateSelectionFromText`（若 PR-6 仍需要序号选择）；其余删除 |
| `src/stores/chat.ts` | 评估 `pendingTemplateSelection` 是否仍需要（可改为模型展示列表、用户回复序号由模型二次 search） |

### 保留（显式 UI 入口）

```typescript
// dispatch-chat-send 步骤 2 — 不变
if (workflowId) {
  await sendWithWorkflow(text, workflowId, ...);
  return;
}
```

### 验收

- [ ] 「帮我创建结算对账工作流」→ 模型 `search_workflow_templates` → 自然语言引导（非本地静态列表）
- [ ] 「创建文件」→ 普通聊天
- [ ] `/` 选模板 → 仍走 `sendWithWorkflow` + `parameter_form`

### 依赖

- PR-1 必须已合；建议 PR-2 prompt 已加强

---

## 6. PR-5 — 补全 Tools + Handler（创建链路）

**目的**：创建类动作全部经模型 tool，前端只跟 UI。

### 新增 Tool（`sto-workflow-tool`）

| Tool | resultType | Handler |
|------|------------|---------|
| `get_workflow_schema` | `workflow_schema_ready` | 渲染 `parameter_form`、`setPendingWorkflow` |
| `create_workflow` | `workflow_created` | `saveWorkflowRecord` |
| `get_workflow_status` | `workflow_run_status` | 更新 `workflow_card`（可选，Tracker 仍为主） |

### 前端

| 文件 | 内容 |
|------|------|
| `src/hooks/use-builtin-tool-listener.ts` | 注册 `workflow_schema_ready`、`workflow_created` handler |
| `src/lib/builtin-tool-envelope.ts` | 扩展 type 与 data 类型 |
| `sto-builtin-tools.manifest.json` | 更新 tools 列表 |

### 验收

- [ ] 端到端：search → get_schema → 表单 → create → execute → card → 完成总结
- [ ] Handler 内部委托 `workflow-api.ts` / `applyWorkflowRunStarted`，不复制 HTTP 逻辑
- [ ] `sto-workflow-tool` 单测覆盖新 tool

---

## 7. PR-6 — 收窄 `tryResolvePendingWorkflow`

**目的**：参数收集以 `parameter_form` + 模型引导为主，减少前端从 NL 提取参数抢先 create/start。

### 策略（二选一，PR 描述里写明）

**方案 A（推荐）**：保留 `pendingWorkflow` 状态机，但 **仅** 处理：
- 表单提交 → `createAndStartWorkflowDirect`
- 用户「取消」→ `clearPendingWorkflow`
- **删除** NL 参数提取 + `isReExecutionIntent` memory 恢复（已由 PR-3 去掉）

**方案 B**：表单提交也改模型 `create_workflow` + `execute_workflow`；`tryResolvePendingWorkflow` 仅做取消清理。

### 改动范围

| 文件 | 操作 |
|------|------|
| `src/hooks/use-workflow-send.ts` | 精简 `tryResolvePendingWorkflow` |
| `src/hooks/dispatch-chat-send.ts` | 步骤 4 仅保留表单确认 / 取消 |
| `parameter-form` handler | 不变 |

### 验收

- [ ] 填表点确认 → 工作流启动（不经 NL 正则）
- [ ] 填表过程中发「取消」→ 恢复普通聊天
- [ ] 无前端 `createAndStartWorkflowDirect` 与模型 `create_workflow` 双触发

---

## 8. PR-7 — 清理与文档

### 删除 / 废弃

- [ ] `use-workflow-intent.ts` 大部分导出（或整文件删除）
- [ ] `appendLocalConversationTurn` 用于工作流澄清的调用
- [ ] `buildWorkflowClarificationPrompt`、`buildTemplateSelectionPrompt`（若无引用）
- [ ] `detectWorkflowIntent`、`shouldSearchWorkflowTemplates` 文档引用

### 更新文档

- [ ] `plans/sto-builtin-tools-platform.md` §2.1 发送顺序改为终态
- [ ] `docs/WORKFLOW-IMPLEMENTATION-SCHEME.md` 增量说明
- [ ] `openspec/changes/sto-builtin-tools-platform/tasks.md` 勾选完成项

### 通信回归

- [ ] 若改动 gateway 消息路径：`pnpm run comms:replay` + `comms:compare`

---

## 9. 手工验收用例（每个 PR 至少跑一遍）

| # | 用户输入 | 期望路径 |
|---|----------|----------|
| 1 | 帮我在桌面建文件夹，创建这些文件 | 普通聊天，**无** workflow tool |
| 2 | 没有识别全，再运行一遍 | 普通聊天（PR-3 后） |
| 3 | 再跑一遍工作流（会话有 wf_xxx） | `execute_workflow` → card |
| 4 | 帮我创建政策审批自动巡检工作流 | `search_workflow_templates` → schema → 表单 |
| 5 | `/` 选择「政策审批…」 | `sendWithWorkflow`，不经 search tool |
| 6 | 工作流执行完成后 | `workflow-completion-delivery` 总结仍触发 |

---

## 10. 迁移期开关（可选）

若需灰度，在 `src/stores/settings.ts` 或 feature flag 增加：

```typescript
workflowToolRouting: 'legacy' | 'tool' | 'tool-only'
```

| 模式 | dispatch 行为 |
|------|----------------|
| `legacy` | 当前步骤 1–4 全开 |
| `tool` | 步骤 1–3 关闭，步骤 4 保留；模型 tool 并行 |
| `tool-only` | 仅步骤 2（`/`）+ 步骤 4 表单 + 步骤 5 |

默认开发环境 `tool`，稳定后改 `tool-only` 并删 legacy。

---

## 11. 终态 `dispatchChatSend`（目标）

```
1. workflowId（/ 或选择器）     → sendWithWorkflow
2. pendingWorkflow 表单确认/取消 → tryResolvePendingWorkflow（极简）
3. sendMessage                  → 模型决策 + builtin tools
```

**不再存在**：`tryStartRememberedWorkflowSend`、`tryNaturalLanguageWorkflowSend`、关键词意图文件。

---

## 12. 与 OpenSpec tasks 映射

| OpenSpec task | 本计划 PR |
|---------------|-----------|
| 2.4 bundle 脚本 | PR-1 |
| 3.x listener | 已完成；PR-5 扩展 handler |
| 4.1 narrow tryStartRememberedWorkflowSend | PR-3 |
| 4.2 remaining tools | PR-5 |
| （新增）去掉 NL 拦截 | PR-4 |
| （新增）tryResolvePending 收敛 | PR-6 |
| 4.3 comms replay | PR-7 |
