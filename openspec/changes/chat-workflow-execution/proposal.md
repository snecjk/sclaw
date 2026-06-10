## Why

用户需要在对话框中通过斜杠命令快速触发预定义工作流模板，按步骤填写参数后执行，并在对话中实时查看执行进度和结果。当前系统仅有一个"工作流"占位符 tab，无实际工作流触发、表单填写和执行跟踪能力。

## What Changes

- **ChatInput 新增斜杠命令**：输入 `/` 触发工作流模板选择下拉，选中后渲染高亮 chip，发送时携带 `workflowId`
- **模板详情查询与表单映射**：选中模板后查询详情，将 `schema.fields` 映射为 `UserFormConfig`，支持从用户输入文本自动提取默认值
- **工作流创建与执行**：表单提交后调用后端 API 创建工作流并执行，返回 `executionId`
- **Main Process Tracker**：轮询查询执行状态，通过 IPC 推送到 Renderer
- **消息卡片渲染**：assistant 消息中嵌入 `workflow_card` content block，同一气泡内实时更新执行状态（步骤时间线、进度、产物）
- **刷新恢复**：页面加载后通过 `workflow:sync-state` IPC 重新关联 Tracker 状态，Tracker 已清理时 fallback 到后端查询

## Capabilities

### New Capabilities

- `chat-workflow-trigger`: 斜杠命令触发工作流模板选择，WorkflowChip 高亮展示，发送携带 workflowId
- `chat-workflow-form`: 模板详情查询，`schema.fields` 到 `UserFormConfig` 的字段映射与表单弹出，支持参数默认值从用户输入自动提取
- `chat-workflow-execution`: 工作流创建与执行调用，Main Process Tracker 轮询状态，IPC 状态推送到 Renderer，消息内 workflow_card 实时渲染

### Modified Capabilities

- *(none — 本变更不修改现有 spec-level 行为，仅新增能力)*

## Impact

- **Renderer**: `ChatInput.tsx`, `Chat/index.tsx`, `ChatMessage.tsx`, `chat store`
- **Main Process**: 新增 `WorkflowExecutionTracker` 服务，注册 IPC handlers
- **API**: 新增 `/api/workflows/templates`, `/api/workflows`, `/api/workflows/:id/execute`, `/api/workflows/:id/status/:executionId`
- **Gateway**: `chat.send` RPC 参数新增 `workflowId` 和 `executionId`（透传，不修改 Gateway 协议）
- **UI 主题**: workflow_card 组件遵循 `docs/sto-design.md` 配色与圆角规范
