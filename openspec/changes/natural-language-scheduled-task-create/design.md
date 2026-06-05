## Context

当前 StoClaw 应用中，用户通过自然语言对话创建定时任务时，系统仅在本地创建任务记录，未调用云端 STO Scheduled Tasks API。这导致任务无法跨设备同步，且不会出现在云端任务列表中。

用户期望的完整流程：
1. 在对话中描述定时任务（如"每天早上 9 点生成周报 PPT"）
2. AI 模型识别意图并调用 `create_scheduled_task` 工具
3. 工具返回提取的参数
4. 前端弹出确认框，用户可编辑参数
5. 用户确认后调用云端 API 创建
6. 创建成功后引导跳转到定时任务列表页

## Goals / Non-Goals

**Goals:**
- 实现从自然语言到定时任务参数的自动提取（通过 AI 模型）
- 提供参数确认和补充的 UI 交互
- 确保任务创建到 STO 云端（`/agent/v1/scheduled-tasks`）
- 创建成功后提供清晰的反馈和跳转引导
- 遵循 docs/sto-design.md 设计规范

**Non-Goals:**
- 不修改现有手动创建定时任务的流程
- 不支持编辑已创建的云端任务（由其他功能覆盖）
- 不处理任务执行结果的回写（由轮询服务处理）

## Decisions

### 1. 参数提取方式

**决策**: 使用 OpenClaw Tool 机制 + AI 模型理解

- **内置 Tool** (`create_scheduled_task`): 定义在 `sto-plugin/sto-scheduled-task-tool/` 中
- Tool 的 inputSchema 定义参数结构，AI 模型负责从自然语言中提取
- Tool 返回提取的参数，标记为需要确认
- 前端监听 tool_call 事件，弹出确认框

**Rationale**: 
- AI 模型能更好地理解复杂的自然语言表达
- Tool 机制是 OpenClaw 的标准扩展方式
- 参数确认在前端完成，保证用户体验

**替代方案**:
- 前端关键词匹配：无法处理复杂语义，已放弃
- 远程 API 意图识别：增加延迟和依赖

### 2. 参数确认 UI 形式

**决策**: 使用 Modal 弹窗 (`TaskNlCreationModal`) 而非 Inline 表单

**Rationale**:
- Modal 提供明确的"确认 - 取消"边界，符合 STO 设计规范
- 可以复用现有 `TaskCreateModal` 的视觉样式
- 避免在对话流中插入复杂表单导致的布局问题

**替代方案**:
- Inline 表单：更轻量，但边界模糊，易与对话内容混淆
- 独立页面：过于重量级，打断用户流程

### 3. 数据存储位置

**决策**: 任务数据仅存储在云端，本地不持久化

**Rationale**:
- 保证跨设备同步的一致性
- 避免本地/云端数据冲突
- 简化状态管理逻辑

**替代方案**:
- 本地 + 云端双写：增加复杂性，易产生数据不一致
- 仅本地存储：无法解决当前问题

### 4. 创建成功后的反馈

**决策**: Toast 提示 + 自动跳转到定时任务列表页

**Rationale**:
- Toast 提供即时反馈（docs/sto-design.md 中的成功状态色：Green-10）
- 自动跳转帮助用户快速定位新创建的任务
- 符合"创建 - 查看"的用户心智模型

**替代方案**:
- 仅 Toast 提示：用户需要手动导航查看
- 仅跳转：缺乏明确的成功反馈

## Risks / Trade-offs

### [Risk] AI 模型提取准确率

**描述**: AI 模型可能错误理解用户意图，提取错误的参数

**Mitigation**:
- 在确认 Modal 中清晰展示提取结果
- 提供手动编辑所有参数的入口
- Tool 返回时标记"需要确认"，不直接创建

### [Risk] 云端 API 调用失败

**描述**: 网络问题或 API 限流可能导致创建失败

**Mitigation**:
- 显示明确的错误信息
- 提供重试按钮
- 失败时保留已填写的参数，避免用户重新输入

### [Risk] Tool 调用与前端 UI 的同步

**描述**: Tool 调用结果需要正确传递到前端确认框

**Mitigation**:
- 使用标准化的 tool_call 事件格式
- 前端通过 toolName 识别定时任务工具
- 在 tool result 中携带 extractedParams 数据

## Migration Plan

1. **Phase 1**: 创建内置 Tool 定义（sto-plugin/sto-scheduled-task-tool/）
2. **Phase 2**: 实现参数确认 Modal 组件
3. **Phase 3**: 前端监听 tool_call 事件，触发确认框
4. **Phase 4**: 实现云端 API 调用和跳转逻辑
5. **Phase 5**: 添加单元测试和 E2E 测试

**Rollback Strategy**:
- 功能开关控制，默认关闭
- 如发现问题，可通过配置快速禁用

## Open Questions

1. 是否需要支持多语言自然语言提取（当前仅支持中文）？
2. 是否需要记录创建历史用于优化提取准确率？
3. 是否需要在创建时支持高级选项（如通知方式、执行结果回写）？
