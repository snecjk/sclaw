## Why

StoClaw 的新 STO 定时任务（Scheduled Tasks）已在云端执行（通过 XXL-JOB 调度），但执行完成后不会主动推送到用户本地 Claw。用户无法感知定时任务已完成，也无法在 Chat 界面回顾执行结果。当前仅实现了手动 trigger 的同步结果写入本地会话（`scheduled-task:{taskId}`），自动定时执行的异步结果完全缺失，造成体验断档。

## What Changes

- **Main 进程轮询器**：新增 `ScheduledTaskResultPoller`，以串行队列方式定期查询云端任务执行历史（`GET /agent/v1/scheduled-tasks/{task_id}/runs`），避免多任务并发阻塞进程。
- **结果持久化与会话合成**：轮询到新结果后，复用 `scheduled-task-session-writer.ts` 将执行结果追加为 `assistant`/`system` 消息到本地 `scheduled-task:{taskId}` 会话，与手动 trigger 的结果共存于同一会话。
- **离线补偿**：持久化 `lastSyncTime` 与已处理 run ID，应用启动时自动补偿离线期间遗漏的结果。
- **红点未读提醒**：Main 进程通过 IPC 推送新结果事件到 Renderer，前端 Sidebar 的「定时任务」入口显示红点；用户进入 Scheduled Tasks 页面后清除未读。
- **任务级高频轮询**：用户手动 trigger 或预期近期有结果时，可对该任务开启短周期高频轮询（5s 间隔，带退避），快速感知完成状态。

## Capabilities

### New Capabilities
- `scheduled-task-result-sync`：云端定时任务执行结果的轮询、本地缓存、去重，以及向 `scheduled-task:{taskId}` 会话的合成写入。
- `scheduled-task-unread-badge`：定时任务执行结果的前端未读红点提醒与清除机制。

### Modified Capabilities
- （无现有 spec 级需求变更；实现层面复用 `scheduled-task-trigger-session` 已建立的会话写入能力，不修改其接口契约。）

## Impact

- `electron/services/scheduled-task-service.ts`：新增 `getTaskRuns(taskId)` 方法。
- `electron/services/scheduled-task-session-writer.ts`：复用现有 `appendTriggerResultToSession`，无需接口变更。
- `electron/main/index.ts`、`electron/main/ipc-handlers.ts`：启动/停止轮询器生命周期，新增 IPC 推送通道 `scheduled-task:new-result`。
- `electron/preload/index.ts`：新增监听通道白名单。
- `src/stores/scheduled-task-unread.ts`：新增 Zustand 未读状态 store。
- `src/components/layout/Sidebar.tsx`：Scheduled Tasks 导航项增加红点。
- `src/pages/ScheduledTasks/index.tsx`：页面激活时清除未读标记。
