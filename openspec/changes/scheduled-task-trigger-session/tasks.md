## 1. Main Process - Session Writer Service

- [x] 1.1 创建 `electron/services/scheduled-task-session-writer.ts`，参照 `cloud-session-writer.ts` 实现会话管理基础结构（`readSessionStore`、`writeSessionStore`、`findSessionEntry`）
- [x] 1.2 实现 `ensureSession(taskId: number, taskName: string)`：首次执行时创建 `{openClawConfigDir}/scheduled-tasks/{taskId}/sessions/sessions.json` 和 `{uuid}.jsonl`，会话 label 使用 taskName；后续执行复用已有会话（Requirement: Scheduled task local session creation on first trigger / Scheduled task local session reuse on subsequent triggers）
- [x] 1.3 实现 `appendTriggerResultToSession(taskId: number, run: TriggerRunResult)`：将 `executionResult` 包装为 `assistant` 消息、`logText` 包装为 `system` 消息追加到 `.jsonl`（Requirement: Execution result appended as assistant message / Execution log appended as system message）
- [x] 1.4 实现 `readScheduledTaskSessionHistory(sessionKey: string, limit?: number)`：读取对应 `.jsonl` 并返回 chronological 消息数组（Requirement: Session history readable via host API）

## 2. Main Process - API Routes & Service Integration

- [x] 2.1 修改 `electron/services/scheduled-task-service.ts`：`triggerTask` 返回完整的 `run` 对象（含 `status`、`executionResult`、`logText`），当前只返回了 `{ runId, outcome }`（Requirement: Execution result appended as assistant message）
- [x] 2.2 修改 `electron/api/routes/scheduled-tasks.ts`：在 trigger 路由中，拿到 `triggerTask` 结果后调用 `appendTriggerResultToSession`，并在响应中加入 `hasSession: true/false`（Requirement: Trigger response returns session presence to frontend）
- [x] 2.3 在 `electron/api/routes/scheduled-tasks.ts` 中新增 `GET /api/scheduled-tasks/session-history` 路由，解析 `sessionKey` 参数并调用 `readScheduledTaskSessionHistory`（Requirement: Session history readable via host API）

## 3. Renderer - Chat Store & Session Utilities

- [x] 3.1 扩展 `src/stores/chat/cron-session-utils.ts`：新增 `parseScheduledTaskSessionKey`、`isScheduledTaskSessionKey` 函数，支持 `scheduled-task:{taskId}` 前缀解析（Requirement: Session key parsing support in chat store）
- [x] 3.2 扩展 `src/stores/chat/history-actions.ts`：新增 `loadScheduledTaskFallbackMessages`，当 `isScheduledTaskSessionKey` 为真时调用 `/api/scheduled-tasks/session-history` 加载历史（Requirement: Session key parsing support in chat store）
- [x] 3.3 修改 `src/stores/chat/session-actions.ts` 中的 `loadSessions`：确保 scheduled task 会话能被正确识别并在侧边栏展示（如需要从 `sessions.json` 中读取 label）

## 4. Renderer - Store & Page Updates

- [x] 4.1 修改 `src/stores/scheduledTasks.ts`：`triggerTask` 接收完整的 trigger 响应（含 `run` 对象和 `hasSession`），不再丢弃 `executionResult` 和 `logText`（Requirement: Trigger response returns session presence to frontend）
- [x] 4.2 修改 `src/pages/ScheduledTasks/index.tsx`：`handleTrigger` 在成功后根据 `hasSession` 提示用户"执行完成，已添加到会话"，并提供跳转到对应会话的入口（Requirement: Trigger response returns session presence to frontend）

## 5. Verification & Documentation

- [x] 5.1 运行 `pnpm run typecheck` 确保 TypeScript 无类型错误
- [x] 5.2 检查 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否有需要更新的内容（如新增 API 路由说明）
