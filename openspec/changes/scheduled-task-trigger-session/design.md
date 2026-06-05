## Context

新 STO 定时任务（Scheduled Tasks）的 `POST /trigger` 接口同步返回执行结果，包含 `run.executionResult`（markdown 正文）、`run.logText`（trace 日志）和 `run.status`（`success`/`failed`/`pending`）。当前代码中，trigger 结果仅通过 `console.log` 输出，前端仅 toast "测试运行已触发"，用户无法回顾执行历史。

参照 Cloud Cron 的 `cloud-session-writer.ts` 实现模式，需要为新的 STO 定时任务建立独立的本地会话管理机制，使用户能在聊天界面中查看每次触发执行的完整结果。

## Goals / Non-Goals

**Goals:**
- 首次触发执行后，自动在本地创建定时任务专属会话
- 后续触发执行后，将结果追加到同一个会话中
- 会话内容可在前端聊天界面正常加载和展示
- 会话名称默认使用定时任务名称，便于用户识别

**Non-Goals:**
- 不实现云端执行结果的定时轮询/同步（本次仅覆盖 `trigger` 手动触发的场景）
- 不实现 Gateway 级别的 cron 自动执行结果捕获
- 不修改 Cloud Cron 或 Legacy Cron 的现有会话逻辑
- 不实现任务删除时的本地会话自动清理

## Decisions

### 1. Session Key 格式：`scheduled-task:{taskId}`

**Rationale**: 新 STO 定时任务不绑定 `agentId`，使用独立的命名空间可避免与 `agent:{id}:cron:{id}` 混淆，同时便于前端通过前缀快速识别。

**Alternative considered**: `agent:default:scheduled-task:{taskId}` — 复用现有 `getAgentIdFromSessionKey` 解析逻辑。Rejected：引入无意义的 `default` agent 概念，增加理解成本。

### 2. 存储位置：`{openClawConfigDir}/scheduled-tasks/{taskId}/sessions/`

**Rationale**: 与 Cloud Cron 的 `agents/{agentId}/sessions/` 完全隔离，避免不同定时任务体系的文件混杂。每个任务拥有独立的 `sessions.json` 和 `.jsonl` 文件，结构清晰。

**Alternative considered**: 复用 `agents/default/sessions/` 目录。Rejected：混合存储会导致 Cloud Cron 和 STO 定时任务的会话管理逻辑耦合，增加维护难度。

### 3. 消息格式复用 Cloud Cron 的 `assistant` 消息结构

**Rationale**: 保持与现有 `cloud-session-writer.ts` 的消息格式一致，前端无需额外适配即可正确渲染。

```jsonl
{"type":"session","version":1,"id":"...","timestamp":"..."}
{"type":"message","timestamp":"...","message":{"role":"assistant","content":"executionResult markdown"}}
{"type":"message","timestamp":"...","message":{"role":"system","content":"logText trace日志"}}
```

**Alternative considered**: 自定义消息格式（如增加 `runId`、`outcome` 等元数据字段）。Rejected：前端聊天组件已适配现有格式，引入新格式需要修改渲染逻辑，增加复杂度。

### 4. 触发时机：在 Main 进程的 trigger 路由中同步写入

**Rationale**: `trigger` 接口同步返回结果，在路由处理层直接调用 session writer 是最简单的方案，无需前端轮询或 IPC 回调。

**Alternative considered**: 前端拿到结果后通过 IPC 通知 Main 进程写入。Rejected：增加不必要的 IPC 往返，且 Main 进程已持有完整结果。

### 5. 会话名称来源：定时任务 `name` 字段

**Rationale**: 任务名称是用户最直观的标识，在聊天侧边栏中直接显示任务名，降低认知成本。

**Implementation**: 在 `createSessionEntry` 时，将 `label` 字段写入 `sessions.json` 的对应 entry，前端 `loadSessions` 时读取展示。

## Risks / Trade-offs

- **[Risk]** `run.status` 可能为 `pending`，trigger 返回时执行尚未完成，此时写入的 `executionResult` 可能为空或不全。
  - **Mitigation**: 在 `appendTriggerResultToSession` 中判断 `status`；若为 `pending`，写入一条 "执行中，请稍后查看…" 的占位消息，并记录 `runId` 供后续轮询补充。本次先实现同步终态写入，`pending` 处理作为后续增强。

- **[Risk]** 用户删除任务后，本地 `scheduled-tasks/{taskId}/` 目录残留，造成磁盘空间浪费。
  - **Mitigation**: 当前与 Cloud Cron 行为一致（删除任务不清理会话）。如需清理，后续可在删除 API 中增加 `fs.rm` 调用，或提供批量清理工具。

- **[Risk]** 频繁触发同一个任务可能导致 `.jsonl` 文件无限增长。
  - **Mitigation**: 与 Cloud Cron 保持一致，当前不做文件大小限制。如需限制，后续可通过 `.jsonl` 轮转或按时间分片实现。

- **[Risk]** 多个客户端（如多设备登录）对同一个 `sessions.json` 并发写入可能导致数据丢失。
  - **Mitigation**: 当前 Electron 应用为单实例运行，不存在多进程并发写入同一文件的场景。如未来支持多实例，需引入文件锁或原子写入。
