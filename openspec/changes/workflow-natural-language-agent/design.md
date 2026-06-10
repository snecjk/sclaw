## Context

StoClaw 工作流功能一期已实现完整的 API 调用层（`workflow-api.ts`）、表单系统（`parameter_form`）、状态追踪器（`WorkflowExecutionTracker`）和卡片渲染（`WorkflowCard`）。当前触发方式仅有 `/` 斜杠命令：用户手动选择模板后，前端直接注入 assistant message 和 parameter_form，全程 AI 不参与。

用户期望的交互体验是：通过自然语言（如"帮我创建结算对账工作流"）即可触发工作流，AI 在参数引导、执行状态告知、结果总结等环节深度参与，而 `/` 仅作为引导不熟悉命令的用户的 UI 快捷入口。

后端 Agent Workflow Client API 已提供 6 个接口（`search` / `startup-schema` / `create` / `start` / `run query` / `run stream`），前端已有完整对接。

## Goals / Non-Goals

**Goals:**
- 用户自然语言输入可触发工作流模板查询和匹配
- `/` 命令保留但仅作为模板选择器的快捷入口，选择后仍走自然语言链路
- AI 引导用户确认工作流参数（通过对话上下文注入 schema 信息）
- 保留前端 `parameter_form` 交互式表单作为参数收集的主要载体
- 支持用户通过自然语言回复补充/修改参数（前端从文本提取回填表单）
- 工作流执行完成后，自动触发 AI 生成结果总结和产物输出
- 长记忆：已创建的工作流支持跨会话恢复和再次执行

**Non-Goals:**
- 不引入 OpenClaw Plugin Tool（sto-plugin）或 MCP 协议
- 不修改 Gateway 协议以支持 tool_result 注入或自定义 tool calling
- 不替换现有的 `WorkflowExecutionTracker` 轮询机制（SSE 增强为 P1）
- 不实现工作流编辑/设计器
- 不实现跨会话系统通知

## Decisions

### 1. 前端状态机驱动 API 调用，而非 OpenClaw Plugin Tool

**决策**: 工作流的 HTTP API 调用（search / get-schema / create / start）由前端 Renderer 直接执行，不通过 OpenClaw Plugin 中转。

**理由**:
- 现有 `src/lib/workflow-api.ts` 已完整对接后端 6 个接口，复用成本最低
- 前端直接调用可即时弹出 `parameter_form` 和 `workflow_card`，无需等待 Gateway 消息往返
- Plugin Tool 运行在后端 Gateway 进程，无法直接驱动前端 UI（表单、卡片、Tracker）
- Plugin Tool 的 `execute` 是同步返回，不支持 SSE 流式状态推送

**替代方案**: 创建 `sto-workflow-tool` OpenClaw Plugin（qianwen 方案）。→ Plugin 适合暴露纯后端能力，但工作流流程需要前端深度交互，叠加坡度增加架构冗余。

### 2. AI 引导通过对话上下文注入实现，而非 Tool Calling

**决策**: 前端获取 schema 后，将模板信息和参数结构以隐藏上下文形式注入到发送给 Gateway 的 message 中，让 AI 生成自然语言引导文案。

**理由**:
- 不依赖 Gateway 是否支持前端传入 `tools` 参数（当前未验证支持）
- 实现简单可控，无需修改 Gateway/OpenClaw 协议
- AI 回复到达后，前端检测到工作流上下文即可自动渲染 `parameter_form`

**替代方案**: 前端在 `chat.send` 中传入 `tools` 参数，让模型生成 `tool_use` → 前端拦截执行。→ 需要验证 Gateway 对 `tools` 的支持程度，联调成本高，本期不推荐。

### 3. parameter_form 由前端自动渲染，不经过 AI 生成

**决策**: AI 生成参数引导的文本描述，但具体的交互式表单（`parameter_form` content block）由前端在 AI 回复到达后自动追加到消息中。

**理由**:
- Gateway/模型不识别自定义的 `parameter_form` content block 类型，无法直接生成
- 前端掌握 schema 结构，可直接调用 `buildWorkflowFormConfig` 构建表单配置
- 用户获得截图中的分步表单体验（单选/多选/可编辑列表），纯自然语言对话无法替代

**替代方案**: 完全通过自然语言对话收集参数（AI 问 → 用户答）。→ 体验与截图不符，复杂参数（如多选、可编辑列表）的准确性和效率远低于表单。

### 4. 执行完成后通过结构化 user message 触发 AI 总结

**决策**: `WorkflowExecutionTracker` 检测到 `completed` 状态后，前端构造一条携带结果摘要的 user message 发送给 Gateway，触发 AI 生成最终总结回复。

**理由**:
- 复用现有 `sendMessage` 机制，无需修改 Gateway 协议
- AI 收到结构化数据后可生成带核心指标、异常波动和产物链接的自然语言总结
- 与现有 `dingtalk-mention` 的上下文注入机制一致（system prompt / user message 中附加结构化块）

**替代方案**: Main Process 通过 `gatewayManager.rpc('chat.send', { role: 'toolresult' })` 注入工具结果。→ Gateway 对 `toolresult` 角色的支持未验证，存在协议兼容性风险。

### 5. 长记忆基于 localStorage，不走后端持久化

**决策**: 已创建的工作流元数据（`workflowId` / `templateId` / `collectedInputs`）通过 `workflow-memory.ts` 存储在 `localStorage` 中，支持 30 天 TTL。

**理由**:
- 现有 `workflow-memory.ts` 已实现完整的 CRUD 和过期清理
- 工作流草稿属于用户本地会话状态，后端无对应持久化接口
- 30 天 TTL 足够覆盖"隔天再次执行"的场景

**替代方案**: 后端新增"用户工作流草稿"持久化接口。→ 需要后端配合开发，超出本期范围。

## Risks / Trade-offs

- **[Risk]** 自然语言意图识别误触发（用户提到"工作流"但并非想执行）
  **→ Mitigation**: 增加置信度阈值（`matchScore > 0.85`），低置信度时向用户确认而非自动执行；同时支持 `"取消"` 指令中断流程

- **[Risk]** AI 引导文案与前端表单不同步（AI 说的参数和表单字段不一致）
  **→ Mitigation**: 表单字段直接从 schema 生成，AI 引导文案也基于同一份 schema 构建；前端在注入上下文时提供字段 key → label 的映射表

- **[Risk]** 用户同时用自然语言和表单填写参数，两者冲突
  **→ Mitigation**: 表单值优先，自然语言提取的参数仅作为预回填；用户提交表单时的最终值为准

- **[Risk]** 执行完成后发送结果给 AI，AI 不生成预期总结
  **→ Mitigation**: system prompt 中预设总结模板和输出格式要求；同时前端在 message 中明确标注 `[workflow:complete]` 标记

- **[Risk]** `workflow-memory.ts` localStorage 被清理导致记忆丢失
  **→ Mitigation**: 记忆丢失时降级为正常对话，AI 可引导用户重新提供参数；不阻塞主流程
