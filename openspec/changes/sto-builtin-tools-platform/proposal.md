## Why

工作流、定时任务等企业 API 能力目前分散在前端直调 HTTP 与零散 Plugin Tool 之间。模型在缺少正规 tool 时会误用 `sai-cli` / `exec`。需要统一的 **STO 内置 OpenClaw Tools 平台**，让模型通过 `registerTool` 调用 HTTP API，前端通过结构化 `tool_result` 跟 UI。

## What Changes

- 新增 `sto-plugin/sto-toolkit` 共享 SDK（HTTP、响应信封、`defineStoTool`）
- 新增 `sto-plugin/sto-workflow-tool`（首期 `search_workflow_templates`、`execute_workflow`）
- 新增 `use-builtin-tool-listener` Hub 与工作流 Handler
- 注册插件至 `openclaw-auth` / `plugin-install`（开发态从 `sto-plugin/` 加载）
- 更新 `TOOLS.stoclaw.md` 模型约束
- 迁移期保留 `use-workflow-send` / `dispatch-chat-send` 现有路径

## Capabilities

### New Capabilities
- `host-api-builtin-tools`: Gateway 内置 Plugin Tools 注册与 STO HTTP 调用契约
- `chat-builtin-tool-listener`: Renderer 监听 `tool_result` 并按 `type` 驱动 workflow_card 等 UI

### Modified Capabilities
- `chat-workflow-execution`（`openspec/changes/workflow-natural-language-agent/`）：执行类动作逐步由模型调 `execute_workflow` 承担

## Impact

- `sto-plugin/sto-toolkit/`、`sto-plugin/sto-workflow-tool/`
- `src/hooks/use-builtin-tool-listener.ts`
- `electron/utils/openclaw-auth.ts`、`electron/utils/plugin-install.ts`
- `resources/context/TOOLS.stoclaw.md`
- `plans/sto-builtin-tools-platform.md`（已实现设计文档）
