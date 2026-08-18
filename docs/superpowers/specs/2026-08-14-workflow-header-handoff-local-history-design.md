# 工作流头部无跳变与本地运行记录设计

## 目标

- 进入嵌入式工作流编辑器时，不再依次暴露 Host 头部、双层头部和最终 Web 头部。
- 握手成功后一次性展示 Web 最终头部；握手失败仍可降级使用 Host 头部。
- Web 最终头部在“试运行”和“发布”之间提供“本地运行记录”，复用 Host 已有弹窗与本地 IPC 数据。

## 设计

Host 将嵌入式头部状态从布尔值收敛为 `negotiating | host | web`。进入编辑器先处于 `negotiating`：Host ContentHeader 不渲染，iframe 继续由加载遮罩覆盖；收到认证的 `workflow-editor-ready` 后切换为 `web` 并一次性展示 iframe。握手失败或超时切换为 `host`，恢复现有 Host 头部作为兼容降级。

本地运行记录仍归 Host 所有。bridge v1 增加 `localRunHistory` Host capability 和 `workflow-local-run-history-request` 消息。Web 只负责展示按钮和发送意图；Host 完成 source、origin、workflowId、nonce 和 ready 校验后调用现有 `setLocalRunHistoryOpen(true)`。

## 交互

- 最终按钮顺序：版本列表、保存草稿、试运行、本地运行记录、发布。
- 协商期间只显示统一加载状态，不显示任一业务头部。
- 本地运行记录为只读入口，不因草稿保存状态禁用；AI 锁定或会话未握手时不允许发送 Host 意图。
- 旧 Web 或握手异常继续显示原 Host 头部及其“本地运行记录”入口。

## 验证

- Host：ownership 状态映射、ready 前业务意图不分发、ready 后本地记录意图分发。
- Web：协议校验、controller capability 门控、Topbar 顺序和点击回调。
- 仅运行相关 Vitest、两端 TypeScript 检查和 scoped ESLint。

