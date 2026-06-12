## Context

一期工作流由 Renderer 直调 `workflow-api.ts`（见 `openspec/changes/workflow-natural-language-agent/design.md`）。生产问题：消息落到模型且无 workflow tool 时，模型尝试 sai-cli/exec。`sto-scheduled-task-tool` 已验证「Plugin Tool + 前端 listener」模式。

## Goals / Non-Goals

**Goals:**
- 统一内置 tool 契约（`StoToolEnvelope.type`）
- 工作流首期 tool：`search_workflow_templates`、`execute_workflow`
- 前端 Hub 复用 `appendWorkflowStartedLocalTurn`、Tracker、memory

**Non-Goals:**
- MCP、用 sai-cli 代理工作流 API
- 本期移除全部 `use-workflow-send` 前端拦截
- 修改 `scripts/bundle-openclaw-plugins.mjs`（工程负责人手动同步打包列表）

## Decisions

### 1. OpenClaw Plugin + sto-toolkit SDK

**决策**: 领域插件通过 `../sto-toolkit/` 引用共享 SDK；`plugin-install` 安装 `sto-workflow-tool` 时同步复制 `sto-toolkit` 到 `extensions/sto-toolkit`。

**理由**: 单插件目录复制无法携带 sibling；SDK 独立目录便于后续多领域复用。

**替代**: 内联 toolkit 到 workflow-tool → 不利于定时任务等后续迁入。

### 2. 前端 Hub 而非扩展 dispatch-chat-send

**决策**: `use-builtin-tool-listener` 扫描 `toolresult`；不在本期大改 `dispatch-chat-send` 顺序。

**理由**: 降低回归风险；tool 路径与前端拦截可并存至 Phase 2。

### 3. UI 仍由 Renderer 渲染

**决策**: `parameter_form` / `workflow_card` 不由 Gateway 生成；Handler 调用现有 lib。

**理由**: 与一期 OpenSpec 一致；Gateway 不识别自定义 content block。

## Risks

- **[Risk]** 双路径重复启动工作流 → **Mitigation**: Phase 2 收窄 `tryStartRememberedWorkflowSend`；首期以 tool 路径为主场景（无 workflowId 时模型调 tool）
- **[Risk]** 打包未列入 bundle 脚本 → **Mitigation**: dev 从 `sto-plugin/` 加载；文档注明需同步 `bundle-openclaw-plugins.mjs`
