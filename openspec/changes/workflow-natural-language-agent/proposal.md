## Why

当前 StoClaw 工作流功能仅支持通过 `/` 斜杠命令手动选择模板触发，用户必须知晓斜杠命令的存在并主动操作。随着业务工作流数量增加，自然语言触发（如"帮我创建结算对账工作流"）成为更直觉的交互方式。同时，现有流程中 AI 不参与参数引导和结果总结，导致用户体验生硬。本变更旨在让 AI 深度参与工作流全生命周期，实现"自然语言触发 → AI 引导确认 → 自动执行 → AI 总结产物"的闭环体验。

## What Changes

- **自然语言触发工作流**：用户输入包含"工作流"关键词或相关意图时，系统自动查询并匹配工作流模板，无需依赖 `/` 斜杠命令
- **`/` 命令体验升级**：`/` 从"直接触发执行"降级为"打开模板选择器的 UI 快捷方式"，选择后仍走自然语言对话链路
- **AI 引导参数确认**：获取模板 schema 后，AI 以自然语言引导用户确认各参数含义，而非前端硬编码文案
- **双通道参数收集**：保留前端 `parameter_form` 交互式表单作为主要输入方式，同时支持用户通过自然语言回复补充/修改参数
- **执行完成 AI 总结**：工作流执行完成后，系统自动将结果摘要发送给 AI，由 AI 生成带核心指标、异常波动和产物链接的最终总结回复
- **长记忆增强**：支持基于已创建的工作流进行"再次执行"/"修改参数后执行"，断开后可恢复上下文

## Capabilities

### New Capabilities
- `chat-workflow-nl-trigger`: 自然语言意图识别和工作流模板查询匹配，替代或补充 `/` 斜杠命令触发
- `chat-workflow-ai-guided`: AI 引导工作流参数确认、异常解释和结果总结，提升对话流畅度
- `workflow-execution-completion`: 工作流执行完成后的自动结果汇总和 AI 总结触发机制

### Modified Capabilities
- `chat-workflow-execution`: 现有执行流程的触发方式扩展（从纯斜杠命令扩展到自然语言 + AI 引导），`sendWithWorkflow` 和 `tryResolvePendingWorkflow` 的行为变更

## Impact

- **Renderer**: `src/hooks/use-workflow-send.ts`（重构为两阶段引导+执行）、`src/hooks/use-workflow-intent.ts`（新建）、`src/pages/Chat/index.tsx`（handleSend 意图分支）、`src/stores/workflow-memory.ts`（增强恢复逻辑）
- **Main Process**: `electron/main/services/workflow-execution-tracker.ts`（completed 状态携带 result/artifacts）
- **Gateway 对话上下文**: `sendMessage` 需要支持注入 `workflowContext` 隐藏上下文，让 AI 知晓当前工作流配置
- **UI 主题**: 无新增页面，现有 `WorkflowCard` 和 `ParameterFormCard` 行为不变
