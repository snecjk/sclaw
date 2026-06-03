## Context

StoClaw 的 Scheduled Tasks 体系目前分为两条链路：

1. **手动触发（`POST /trigger`）**：同步返回 `run` 对象，已在 `scheduled-task-trigger-session` change 中实现本地会话写入（`scheduled-task:{taskId}`）。
2. **云端自动执行（XXL-JOB 调度）**：任务到期后云端自动派发执行，但**不主动推送**结果到用户本地 Claw。用户只能在云端查看结果，本地 Chat 会话中完全缺失。

本次设计要解决的就是第二条链路的「结果同步」问题：在本地 Claw 中建立轮询机制，将云端自动执行的结果拉取到本地，并追加到已有的 `scheduled-task:{taskId}` 会话中，与手动 trigger 结果统一展示。

约束：
- 云端 API 为 `scheduled-tasks`（`/agent/v1/scheduled-tasks`），已有 `list`、`details`、`trigger`，需新增 `GET /{task_id}/runs`。
- 同一任务的自动执行结果和手动 trigger 结果必须共存于同一会话。
- 不能阻塞 Electron 主进程，不能对服务端造成过大压力。
- 必须支持离线补偿（用户关闭应用期间的任务结果不能丢失）。

## Goals / Non-Goals

**Goals:**
- Main 进程可靠地轮询云端任务执行结果，并将新结果追加到本地 `scheduled-task:{taskId}` 会话。
- 同一任务的所有执行历史（自动 + 手动）在 Chat 页面中按时间线统一展示。
- 用户通过 Sidebar 红点即时感知有新结果产生。
- 应用重启后能自动补偿离线期间遗漏的结果。
- 高频轮询支持用户 trigger 后的快速结果感知（5s 间隔，带退避）。

**Non-Goals:**
- 不修改云端 `scheduled-tasks` API 的返回结构或推送机制（纯客户端轮询方案）。
- 不修改 `scheduled-task-trigger-session` 已建立的会话 key 格式和存储位置。
- 不在 Renderer 进程中直接发起轮询请求。
- 不实现任务删除时的本地会话自动清理（与现有行为保持一致）。

## Decisions

### 1. 轮询器运行在 Main 进程

**Rationale**：轮询是纯粹的后台 I/O 行为，无需 UI 参与。放在 Main 进程可以：
- 不受 Renderer 页面生命周期影响（用户关闭 Scheduled Tasks 页面后仍可轮询）。
- 避免系统 background throttling 导致 Renderer 定时器延迟或冻结。
- 符合 AGENTS.md 中「Renderer 不直接调用外部 API」的边界原则。

**Alternative considered**：Renderer 中通过 `setInterval` 轮询，经 Host API 代理到 Main。  
**Rejected**：Renderer 被挂起时会漏掉结果；且页面关闭后轮询停止，体验不一致。

### 2. 串行 `setTimeout` 链，禁用 `setInterval`

**Rationale**：使用递归 `setTimeout` 链保证任何时刻**只有一个**轮询请求在执行。如果某次查询耗时较长（如网络抖动），下次查询会顺延，不会产生并发请求堆积。这对「多任务逐一查询 runs」的场景尤为重要。

**Alternative considered**：`setInterval` 固定间隔触发。  
**Rejected**：若某次请求耗时超过间隔，会产生并发请求，导致网络堆积和进程阻塞风险。

### 3. 复用 `scheduled-task:{taskId}` 会话，不新建独立格式

**Rationale**：`scheduled-task-trigger-session` 已为手动 trigger 建立了 `scheduled-task:{taskId}` 会话格式和存储位置（`{configDir}/scheduled-tasks/{taskId}/sessions/`）。自动执行结果追加到同一会话，用户可在 Chat 中统一回顾完整历史，无需区分来源。

**Alternative considered**：为云端自动执行新建 `cloud:scheduled-task:{taskId}` 或 `agent:main:cron:{taskId}` 会话。  
**Rejected**：同一任务分裂为多个会话，增加用户认知成本；且已有 `appendTriggerResultToSession` 可直接复用。

### 4. 用 `electron-store` 持久化 `lastSyncTime` + `processedRunIds`

**Rationale**：`electron-store` 已作为项目标准持久化方案使用（settings、telemetry 等均基于它）。持久化后，应用重启可精确知道上次同步到哪一条 run，避免全量扫描或重复写入。

**Alternative considered**：将状态写入本地 jsonl 文件头部或独立 SQLite。  
**Rejected**：引入新的持久化方案增加维护成本；`electron-store` 已满足需求且支持原子写入。

### 5. 全局低频轮询（30s）+ 任务级高频轮询（5s，退避）

**Rationale**：
- 全局轮询覆盖常规自动执行场景，30s 延迟对定时任务（通常分钟/小时级周期）可接受。
- 用户手动 trigger 后，对**该任务**启动 5s 间隔的高频轮询，最多持续 2 分钟，快速感知完成状态。
- 退避策略（前 5 次 5s，之后 10s）在高频阶段平衡实时性与请求数。

**Alternative considered**：所有任务统一高频轮询（如 5s）。  
**Rejected**：任务数量增长后请求数线性膨胀，对服务端和用户网络均不友好。

### 6. IPC 推送 `scheduled-task:new-result` + Zustand unread store 实现红点

**Rationale**：Main 进程拿到新结果后，通过 `webContents.send` 主动推送到 Renderer，前端立即更新 Sidebar 红点。比前端定时轮询查询更实时、更高效。

**Alternative considered**：前端每 30s 轮询查询「是否有新结果」。  
**Rejected**：延迟高（平均 15s），且产生大量无效请求。IPC 推送是事件驱动，零轮询开销。

## Risks / Trade-offs

- **[Risk]** 用户创建大量定时任务（如 100+），全局轮询时串行查询 `runs` 接口，单次 tick 耗时可能超过 30s，导致轮询间隔被人为拉长。  
  **Mitigation**：在全局 tick 中先用 `listTasks()` 获取所有任务的 `lastRunAt`，仅对 `lastRunAt > lastPolledAt[taskId]` 的任务查询 runs，大幅削减实际请求数。若任务量仍过大，可后续引入批量 `runs` 接口或并发池（限制并发数如 3）。

- **[Risk]** `processedRunIds` 集合随时间无限增长，导致 store 文件膨胀。  
  **Mitigation**：限制集合大小为最近 1000 条（LRU 驱逐），定时任务执行频率通常不会导致短期内产生超过 1000 条未同步记录。

- **[Risk]** 用户多设备登录时，各设备独立轮询，同一 run 可能被多个设备重复写入本地会话。  
  **Mitigation**：本地去重（`processedRunIds`）确保同一设备内不重复；跨设备重复写入目前与 Cloud Cron 行为一致，不影响用户体验（会话中仅出现重复消息，不影响功能）。后续如需严格去重，可在消息元数据中增加 `runId` 并在渲染时过滤。

- **[Risk]** 网络断开期间，全局轮询持续失败，错误日志膨胀。  
  **Mitigation**：轮询器捕获异常后采用指数退避延长下次间隔（30s → 60s → 120s，上限 5min），并减少日志级别为 `warn`，避免 error 风暴。

## Migration Plan

1. **部署**：纯客户端增量功能，无需服务端变更（`GET /{task_id}/runs` 接口已约定在 `scheduled-tasks-claw-api.md` 中）。
2. **回滚**：移除 `electron/main/index.ts` 中的 poller 启动代码即可停止轮询，不影响已有会话数据。
3. **数据兼容**：复用现有 `scheduled-task:{taskId}` 会话格式，旧数据不受影响。

## Open Questions

1. `GET /agent/v1/scheduled-tasks/{task_id}/runs` 接口是否已部署？返回字段名是 `execution_result`（snake_case）还是 `executionResult`（camelCase）？  
   → 实现前需与后端确认，当前按文档中的 snake_case 处理。
2. 是否需要系统级通知（如 macOS notification）还是仅 Sidebar 红点即可？  
   → 当前仅实现 Sidebar 红点，系统通知可作为后续增强。
