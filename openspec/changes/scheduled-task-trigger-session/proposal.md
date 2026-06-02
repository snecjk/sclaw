## Why

新 STO 定时任务（Scheduled Tasks）触发执行后，云端同步返回执行结果（`executionResult`、`logText`、`status`），但当前前端仅 toast 提示"测试运行已触发"，结果没有被持久化到本地。用户无法在前端查看定时任务的执行历史，也无法通过聊天界面回顾过往执行结果。需要参照 Cloud Cron 的 `cloud-session-writer.ts` 模式，为新的 STO 定时任务建立本地会话管理机制。

## What Changes

- **新增 `scheduled-task-session-writer.ts` 服务**：参照 `cloud-session-writer.ts`，实现定时任务本地会话的创建、复用和结果追加。
  - Session Key 格式：`scheduled-task:{taskId}`
  - 存储位置：`{openClawConfigDir}/scheduled-tasks/{taskId}/sessions/`
  - 会话名称默认取定时任务的 `name`
  - 首次执行创建 `sessions.json` + `{uuid}.jsonl`，后续执行复用并追加
- **修改 `electron/api/routes/scheduled-tasks.ts`**：trigger 路由在拿到云端结果后，调用 session writer 将结果写入本地会话。
- **修改 `electron/services/scheduled-task-service.ts`**：`triggerTask` 返回完整的 `run` 对象（含 `executionResult`、`logText`、`status`）。
- **修改 `src/stores/scheduledTasks.ts`**：`triggerTask` 接收并传递完整结果。
- **扩展会话 key 解析**：在 `src/stores/chat/cron-session-utils.ts` 中支持 `scheduled-task:` 前缀。
- **扩展历史加载**：在 `src/stores/chat/history-actions.ts` 中新增 fallback 逻辑，从 `.jsonl` 读取定时任务执行历史。
- **前端交互优化**：trigger 成功后提示用户执行状态，支持跳转到对应会话查看结果。

## Capabilities

### New Capabilities
- `scheduled-task-local-session`: 定时任务本地会话管理，包括会话创建、复用、执行结果追加为 assistant 消息、历史读取。

### Modified Capabilities
- 无现有 spec 需要修改。本次变更主要是新增实现层能力，不改动已有 spec 定义的行为要求。

## Impact

- **Electron Main 进程**：新增 `scheduled-task-session-writer.ts`，修改 `scheduled-task-service.ts` 和 `scheduled-tasks.ts` 路由。
- **Renderer 进程**：修改 `scheduledTasks.ts` store、`history-actions.ts`、`cron-session-utils.ts`。
- **前端页面**：`ScheduledTasks/index.tsx` 中 trigger 后的交互调整。
- **本地存储**：新增 `{openClawConfigDir}/scheduled-tasks/` 目录结构。
