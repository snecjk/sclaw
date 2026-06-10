## Context

StoClaw 是 Electron 桌面应用，对话系统已有完整的 Gateway WS 消息通道和表单系统（`UserFormModal` + `form-api.ts`）。工作流功能目前仅有 `ChatPreviewPanel` 中的占位符 tab，无实际触发、表单和执行跟踪能力。

后端已提供工作流模板接口，返回 `schema` 结构（含 `steps` 和 `fields`），`fields` 使用 `component` 字段定义表单控件类型（如 `single_select`、`multi_select`），并通过 `group` 关联到执行步骤。

## Goals / Non-Goals

**Goals:**
- 用户在 ChatInput 中通过 `/` 斜杠命令选择工作流模板
- 模板详情查询后，将 `schema.fields` 映射为 `UserFormConfig` 弹出表单
- 表单提交后创建并执行工作流，执行状态在同一 assistant 消息气泡内实时更新
- 刷新页面后能恢复卡片状态（Tracker 在 Main Process 持续运行）

**Non-Goals:**
- 不修改 Gateway 协议（状态更新不走 Gateway 推送）
- 不实现工作流编辑/设计器（仅消费已有模板）
- 不实现跨会话系统通知（P2，本期不做）
- 不实现 tool_result 注入（P2，需 Gateway 协议支持）

## Decisions

### 1. 状态更新走 IPC，不走 Gateway 推送

**决策**: Main Process `WorkflowExecutionTracker` 轮询后端状态，通过 IPC `workflow:status-update` 直接推送到 Renderer。

**理由**:
- Gateway `chat.send` 只能追加新消息，无法修改已有消息中的卡片状态
- 若每次状态变化都发 Gateway 消息，会产生大量假 assistant 消息，污染对话历史和 token 统计
- IPC 零 token 成本、零历史污染

**替代方案**: Gateway 自定义事件类型（`workflow:status`）→ 需要修改 Gateway 后端协议，侵入性大，联调成本高。

### 2. 表单字段从 `schema.fields` 映射，而非模型分析驱动

**决策**: 模板详情接口返回的 `schema.fields` 直接映射为 `UserFormConfig.fields`，不经过模型分析。

**理由**:
- 模板已预定义参数结构，无需每次模型参与
- `fields[].component` 可直接映射为 `FormFieldType`（如 `single_select` → `select`）
- 性能更好，响应更快

**替代方案**: 模板 + 用户输入发给模型 → 模型返回需要补充的字段 → 构建表单。→ 增加模型调用延迟，且模型可能遗漏字段。

### 3. 前端限制并发数 + Tracker Map 兜底

**决策**: 前端限制同一会话最多 5 个并发工作流，Tracker 限制最多跟踪 50 个 execution。

**理由**:
- 桌面场景用户不太可能同时触发大量工作流，但防御性限制避免意外滥用
- 前端限制用户体验更好（提交前即提示），Tracker 限制是系统级兜底

**替代方案**: 仅 Tracker 限制 → 用户到提交阶段才报错，体验差。

### 4. `workflow:sync-state` + 后端 fallback 的刷新恢复

**决策**: 页面加载后 Renderer 从 messages 提取 executionId，先问 Tracker（`sync-state` IPC），Tracker 已清理则直接查后端。

**理由**:
- Tracker 在 Main Process 持续运行，正常情况刷新后可直接恢复
- Tracker 可能因内存清理或超时而删除 session，此时 fallback 到后端查询最终状态
- 后端也查不到则标记 `unknown`，避免卡片永远卡在 `pending`

**替代方案**: 仅依赖 Tracker → Tracker 清理后卡片无法恢复。仅依赖后端 → 刷新后每次都要 HTTP 查询，增加不必要的请求。

### 5. 本期采用前端 `sendMessage` 完成后续对话，不用 tool_result 注入

**决策**: 工作流完成后，前端发送一条携带结果摘要的用户消息，触发模型继续回复。

**理由**:
- tool_result 注入需要 Gateway 协议支持 `role: 'toolresult'`，当前不确定是否支持
- 前端 sendMessage 简单可控，不阻塞本期上线

**替代方案**: Main Process 调用 `gatewayManager.rpc('chat.send', { role: 'toolresult' })` → 下期优化。

## Risks / Trade-offs

- **[Risk]** IPC 广播时未过滤 sessionKey → 窗口 A 的卡片状态闪现在窗口 B  
  **→ Mitigation**: Tracker 广播携带 `sessionKey`，Renderer 收到后只处理匹配当前会话的更新

- **[Risk]** Tracker Map 无限增长导致内存泄漏  
  **→ Mitigation**: Map 上限 50；completed/failed 保留 5 分钟后自动清理；定期 cleanup timer

- **[Risk]** 后端 API 未就绪阻塞前端开发  
  **→ Mitigation**: 先用 mock 数据开发 UI，接口 Ready 后替换

- **[Risk]** `schema.fields[].component` 类型与 `FormFieldType` 不完全对齐  
  **→ Mitigation**: 建立映射表，不认识的 component 类型降级为 `text`，兜底渲染

- **[Risk]** 用户同时创建大量工作流导致后端资源紧张  
  **→ Mitigation**: 前端限制同一会话最多 5 个并发，Tracker 限制最多 50 个跟踪

- **[Risk]** Gateway 不认识 `workflow_card` content block 类型导致消息解析异常  
  **→ Mitigation**: `ContentBlock` union 扩展，Gateway 不认识的 type 前端兜底渲染为文本描述
