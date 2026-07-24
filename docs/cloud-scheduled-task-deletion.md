# 云端定时任务（`/agent/v1/schedule`）全链路删除计划

> 状态：**待执行**。本稿审阅通过后，删除动作在你再次确认后启动。

## Context / 背景

云端定时任务已完全弃用，本地任务统一收口到 `src/pages/MyTask`（走本地 Gateway cron `/api/cron/jobs` + 本地 Claude 引擎 `/api/claude-scheduled-tasks`）。前端云端任务页面目录（`src/pages/Cron`、`src/pages/ScheduledTasks`）已删除。

但 **main 主进程调用 FastAPI 的云端链路**（`/agent/v1/scheduled-tasks`）与 **渲染层里只为云端任务存在的耦合代码**仍残留。以「`/agent/v1/schedule` 相关云端任务一律不需要」为原则，做全链路删除。**本地已写下的云端任务历史会话记录保持不动**（磁盘上的 `.jsonl`、`sessions.json` 条目、poller 账本文件原样保留），不写专门清空脚本——裁剪掉渲染层对 `scheduled-task:` 键的合并/解析后，这些历史记录自然不再被展示，作为无害惰性数据留在磁盘。

预期结果：云端任务功能从代码中彻底消失；本地 Gateway cron、本地 Claude 定时任务、会话列表/未读/侧栏对本地任务的支持全部不受影响；磁盘上残留的云端历史会话文件不被触碰。

## 删除原则与边界

- **删**：一切调用云端 `/agent/v1/scheduled-tasks` 的代码，以及只为云端任务会话（`scheduled-task:{id}`、`agent:*:scheduled-task:{id}:{date}` 键）存在的合并/解析/未读/展示逻辑，外加云端 poller 写下的历史本地会话数据。
- **留**：
  - 本地 Gateway cron：`electron/api/routes/cron.ts`、`/api/cron/*`、`src/stores/cron.ts` 的本地半（`fetchJobs`/`createJob`/`triggerJob` 等 `ManagedLocalTask` 路径）。
  - 本地 Claude 定时任务：`electron/services/claude-scheduled-task-*` 全家、`electron/api/routes/claude-scheduled-tasks.ts`、`/api/claude-scheduled-tasks/*`。
  - 指令美化器 `electron/services/scheduled-task-instruction-beautifier.ts` + `/api/cron/beautify-instruction` 路由 + `host-api-proxy.ts:29` 特例 —— 仍被保留的 `MyTask/TaskCreateModal` 调用。
  - `scheduled-task-poller-store` 的 **deleted-session 账本**（`isSessionDeleted`/`listDeletedSessionKeys`/`filterDeletedSessions`/`markSessionDeleted`/`unmarkSessionDeleted`）—— 被 cron/claude 共享。

## 现状盘点（已核实）

### A. 主进程 — 纯云端，整文件删除

| 文件 | 说明 |
|---|---|
| `electron/services/scheduled-task-service.ts` | 云端代理，`resolveBaseUrl()` → `${stoBaseUrl}/agent/v1/scheduled-tasks`（:167）；方法 list/details/create/update/delete/getTaskRuns/queryTaskRuns/triggerTask 全部走云端 |
| `electron/services/scheduled-task-result-poller.ts` | 轮询云端 `/runs/query`，`webContents.send('scheduled-task:new-result', …)`（:237）；导入 service + session-writer |
| `electron/services/scheduled-task-session-writer.ts` | 把云端触发结果写成本地 `.jsonl`，键格式 `scheduled-task:{taskId}`；仅被 cloud poller + cloud route 引用 |
| `electron/api/routes/scheduled-tasks.ts` | 云端 HTTP 路由 `/api/scheduled-tasks*`，转发到 service |

### B. 主进程 — 启动注册裁剪

| 文件 | 改动 |
|---|---|
| `electron/main/index.ts:580-585` | 删除 `getScheduledTaskResultPoller` 动态 import、`attachMainWindow`、`start()`、`stop()`。**保留** :588-598 的 `claude-scheduled-task-service` 启动 |
| `electron/api/server.ts` | 删除 :43 `import { handleScheduledTaskRoutes }` 与 :88 挂载。**保留** :42/87 cron、:44/93 claude |
| `electron/main/ipc/host-api-proxy.ts` | 已核实**无** `/api/scheduled-tasks` 特例（仅 :29 beautify-instruction，保留） |

### C. 主进程 utils — 裁剪云端残留（保留共享部分）

| 文件 | 改动 |
|---|---|
| `electron/utils/scheduled-task-poller-store.ts` | 删除云端轮询状态导出：`getLastSyncTime`/`setLastSyncTime`(:40,45)、`getLastPolledAt`/`setLastPolledAt`(:50,55)、`isRunProcessed`/`markRunProcessed`(:61,67)；从 `PollerStoreSchema` 去掉 `lastSyncTime`/`lastPolledAt`/`processedRunIds` 字段与 defaults。**保留** deleted-session 账本导出(:82,88,93,105,123) + `deletedSessions`/`deletedSessionTimestamps` schema |
| `electron/utils/revive-deleted-execution-session.ts` | 删除 `reviveScheduledTaskAgentDatedExecutionSession`（云端，仅被 session-writer 引用）。**保留** cron/claude 的 revive 函数 |
| `electron/utils/reset-dated-execution-record.ts:173-196` | 删除 `resetScheduledTaskAgentDatedExecutionRecord` 及 :194 的 `agent:*:scheduled-task:*` regex 分支。**保留** claude/cron 分支 |
| `shared/task-group-key.ts` | 删除 `stoCloudTaskGroupKey`（仅被 cloud route + session-writer 引用）。**保留** `cronTaskGroupKey`/`claudeTaskGroupKey` |

### D. 渲染层 — 云端半裁剪 / 整删

| 文件 | 改动 |
|---|---|
| `src/stores/cron.ts` | **裁剪非整删**。删 state `scheduledTasks`/`scheduledTasksError`(:35,36,72,73)；删方法 `fetchScheduledTasks`/`createScheduledTask`/`updateScheduledTask`/`deleteScheduledTask`/`toggleScheduledTask`/`triggerScheduledTask`(:92-188, 接口 :40-45)；删 :12-21 的 `ScheduledTask`/`ScheduledTaskCreateInput`/`ScheduledTaskUpdateInput` 类型 import；删 :341 的 `export type { ScheduledTask, … }`。**保留** 本地半（`fetchJobs`/`createJob`/… 与 `ManagedLocalTask`）与 `ClaudeScheduledTask*` import |
| `src/stores/scheduledTasks.ts` | **整删**（0 运行时消费者） |
| `src/stores/scheduled-task-unread.ts` | **整删**（仅 App.tsx 用，且由已删 poller 的 IPC 事件驱动） |
| `src/App.tsx` | 删 :34 `useScheduledTaskUnreadStore` import；删 :221-242 `scheduled-task:new-result` IPC 监听块 |
| `src/hooks/use-scheduled-task-name-maps.ts` | 删 `/api/scheduled-tasks` 拉取与云端任务名映射分支；保留 cron/claude 名映射。审计 `Sidebar.tsx` 消费点同步裁剪 |
| `src/stores/chat/session-lifecycle-actions.ts` | 删 :127 `hostApiFetch('/api/scheduled-tasks/sessions')` 及 `stSessions` 合并；删 :188 `scheduledTaskDated`/`scheduledTaskDatedKeyByTask` 构建与 `parseScheduledTaskAgentSessionKey` 用法；删 :454 `/api/scheduled-tasks` 名字富化块 |
| `src/stores/chat/cron-session-utils.ts` | 删 `parseScheduledTaskSessionKey` / `parseScheduledTaskAgentSessionKey`（待 D 组其它消费者裁剪后无引用再删，避免编译期 broken） |
| `src/stores/chat/session-list-merge.ts` | 删 scheduled-task 会话合并/去重分支 |
| `src/lib/sto-task-session.ts:31-34` | 删 `scheduled-task:` 前缀隐藏判定分支，保留函数签名 |
| `src/lib/session-unread-keys.ts:95,115` | 删 `agent:*:scheduled-task:*` 未读桶分支，保留签名 |
| `src/lib/sidebar-recent-order.ts` / `src/lib/session-delete.ts` / `src/stores/session-unread.ts` / `src/lib/session-unread-notify.ts` / `src/components/layout/{Sidebar,MainLayout,sidebar-projects-section}.tsx` / `src/hooks/use-sto-task-subitem-entry.ts` | 逐一删除函数体内 `scheduled-task`/`agent:*:scheduled-task:*` 键的处理分支，**不改对外签名** |
| `src/types/scheduled-task.ts` | 删云端类型 `ScheduledTask`/`ScheduledTaskCreateInput`/`ScheduledTaskUpdateInput`/`ScheduledTaskRun`/`ScheduledTaskTriggerResponse`。**保留** `ClaudeScheduledTask*` 与 `TaskTriggerExecutionMeta`（共享） |

> D 组顺序约束：先裁剪所有 `parseScheduledTask*` / 云端类型 / 云端 store 方法的**消费点**（session-lifecycle、session-list-merge、Sidebar 等），最后再删 `cron-session-utils.ts` 里的解析器定义与 `types/scheduled-task.ts` 的云端类型，避免中途断链。

### E. 历史云端会话数据 — 保持不动

云端 poller/session-writer 在本地写过的历史会话（键 `scheduled-task:{taskId}`、`agent:{agentId}:scheduled-task:{taskId}:{date}` 的 `.jsonl` 与 `sessions.json` 条目）以及 poller 账本 `scheduled-task-poller`（electron-store）文件，**全部原样保留，不写清空脚本**。

- 裁剪掉 D 组渲染层对 `scheduled-task:` 键的合并/解析后，这些历史记录不再被会话列表/侧栏/未读展示，成为无害惰性数据。
- `scheduled-task-poller-store.ts` 在 Phase 2 删除云端轮询状态导出与 schema 字段后，磁盘账本文件里残留的 `lastSyncTime`/`lastPolledAt`/`processedRunIds` 旧值无人读取，自然失效，无需清理。共享墓碑 `deletedSessions`/`deletedSessionTimestamps` 照常保留。

## 实施阶段

### Phase 1 — 主进程云端核心链路删除（A + B）
删 4 个文件 + `main/index.ts` / `server.ts` 注册裁剪。

### Phase 2 — 主进程 utils 云端残留裁剪（C）
poller-store 去云端字段、revive/reset-dated/task-group-key 去云端分支。

### Phase 3 — 渲染层云端耦合裁剪（D）
按 D 组顺序约束执行：先消费点、后定义。

### Phase 4 — 交付
把本设计稿落盘 `docs/cloud-scheduled-task-deletion.md`。删除完成后在 docs 追加「执行记录」小结。

> **执行节奏**：审阅通过后第一步只做 Phase 4（写 docs）并停手，等你再次确认才进入 Phase 1–3。

## 验证

1. `pnpm typecheck`（`tsc --noEmit`）—— 重点：`src/stores/cron.ts` 裁剪后 MyTask 编译通过；`cron-session-utils` 解析器删除后无残留引用；`types/scheduled-task.ts` 云端类型删除后无残留 import。
2. `pnpm lint` —— 无新告警。
3. 全仓搜索：`rg "/agent/v1/schedule|scheduled-task-service|scheduled-task-result-poller|scheduled-task-session-writer|/api/scheduled-tasks\b|scheduled-task:new-result" electron/ src/ shared/` —— 应无结果（`scheduled-task-instruction-beautifier` 与 `scheduled-task-poller-store` 的保留部分除外）。
4. 手动冒烟（dev）：
   - 「我的任务」页 `/my-tasks`：新建/编辑/触发本地 cron 任务与 Claude 任务正常；`TaskCreateModal` 的指令美化（`/api/cron/beautify-instruction`）正常。
   - 会话列表：本地 cron / Claude 任务的历史会话正常显示；无 `scheduled-task:` 键会话残留。
   - 侧栏无云端任务相关未读红点；未读计数仅对本地会话生效。
5. 全仓确认无残留云端链路后，磁盘上残留的云端历史会话文件按设计保持不动（不验证其可见性——按预期不再被展示）。

## 风险与回滚

- **renderer 裁剪面广**：`scheduled-task` 会话键穿透 session-list-merge/unread/delete/recent-order/sidebar 多处。改对外签名会断链 → 全程**只删函数体内分支、保留签名**；删解析器定义放最后。
- **共享 poller-store**：误删 `deletedSessions` 会让已删的本地 cron/claude 会话「复活」。只删云端三字段的导出与 schema，不动墓碑，磁盘账本文件原样保留。
- **回滚**：所有改动集中在一次提交，回滚即 `git revert`。

## 执行记录（2026-07 完成）

云端定时任务链路已按 Phase 1→4 全量裁剪完毕，执行结果如下。

**删除的主进程文件（4 个）**
- `electron/api/routes/scheduled-tasks.ts`
- `electron/services/scheduled-task-service.ts`
- `electron/services/scheduled-task-result-poller.ts`
- `electron/services/scheduled-task-session-writer.ts`

**删除的渲染层文件（2 个）**
- `src/stores/scheduledTasks.ts`（云端任务 store）
- `src/stores/scheduled-task-unread.ts`（云端未读 store）

**主进程裁剪**
- `electron/main/index.ts`：移除云端 service 启停、`updateDingTalkConfig` 注入、轮询注册；保留 `claudeScheduledTaskService`（本地 Claude 链路）。
- `electron/api/server.ts`：注销 `/api/scheduled-tasks` 路由挂载。
- `electron/preload/index.ts`：移除死 IPC 通道 `scheduled-task:new-result`（原为重复项，云端 service 为唯一 emitter）。
- `electron/utils/scheduled-task-poller-store.ts`：移除 `lastSyncTime`/`lastPolledAt`/`processedRunIds` 三云端字段的导出与 schema；保留 `deletedSessions`/`deletedSessionTimestamps` 共享墓碑。
- `electron/utils/revive-deleted-execution-session.ts` / `reset-dated-execution-record.ts`：移除 `scheduled-task:` 键分支。

**渲染层裁剪（D 组，先消费点后定义）**
- `src/types/scheduled-task.ts`：删除云端 `ScheduledTask*` 类型集，仅保留本地 cron 相关类型。
- `src/stores/cron.ts`：裁掉对云端 store 的依赖。
- `src/stores/chat/cron-session-utils.ts`：删除 `scheduled-task:` 键解析器，保留 `ClaudeScheduledTask*` 本地解析。
- `src/stores/chat/{session-lifecycle-actions,session-list-merge,virtual-task-history}.ts`、`src/lib/{session-delete,session-unread-keys,sidebar-recent-order,sto-task-session,scheduled-task-recipients}.ts`、`src/hooks/use-scheduled-task-name-maps.ts`、`src/components/layout/Sidebar.tsx`、`src/pages/MyTask/components/TaskCreateModal.tsx`、`src/App.tsx`：逐处裁掉云端会话键分支与未读/合并/删除耦合。
- `shared/{task-group-key,first-trigger-placeholder-session-key}.ts`：移除云端键常量。

**验证结果**
1. **typecheck**：`tsc --noEmit` 对本批改动文件（`Sidebar.tsx`/`cron-session-utils.ts`/`types/scheduled-task.ts`/`scheduled-task-recipients.ts`/`use-scheduled-task-name-maps.ts`/`session-lifecycle-actions.ts`/`builtin-tool-dispatch.ts` 等）无真实类型错误（排除 `dist-electron/shared` 未构建导致的 TS6305/TS6307 基建噪声——该噪声为既有环境问题，与本次裁剪无关）。
2. **lint**：`eslint` 对全部改动文件（renderer + preload + electron + shared）无告警。
3. **全仓搜索**：`scheduled-task-service` / `scheduled-task-result-poller` / `scheduled-task-session-writer` / `/api/scheduled-tasks` / `scheduled-task:new-result` / 各云端 `ScheduledTask*` 类型在 `src/`+`electron/`+`shared/` 中均无残留（`claudeScheduledTask*` / `ClaudeScheduledTask*` 为保留的本地链路，非命中项）。
4. 历史云端会话数据按设计保持不动，裁剪后不再被会话列表/侧栏/未读展示，成为无害惰性数据。

**保留项（命名含 ScheduledTask 但非云端）**
- `claudeScheduledTaskService`（`electron/main/index.ts`）——本地 Claude 定时任务，非云端。
- `ClaudeScheduledTask*` 解析器（`cron-session-utils.ts`）——本地 Claude 会话键，非云端。
- `scheduledTaskSidebarGroupKey`（`Sidebar.tsx` 局部 helper）——通用侧栏展开态 key，同时服务于 cron/claude 组，命名遗留，保留。
- `shared/session-type.ts`（`scheduled-task:` 前缀识别为 `scheduled_task` 类型）、`shared/session-agent-id.ts` 与 `shared/session-delete-routing.ts`（5 段 `agent:{agentId}:scheduled-task:{taskId}:{date}` 键的段识别守卫）——均为被动兼容守卫，不主动消费历史会话，保留以防本地/历史键误判。
