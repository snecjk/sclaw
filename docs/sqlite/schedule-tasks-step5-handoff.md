# 定时任务重构 — Step 5 执行接线 / 会话移交

> 本文档为上一会话的工作移交。Step 3（数据层 + 调度器 + 服务 + 测试，**不接生产**）已完成并通过验证。
> 新会话直接从「Step 5 执行接线」开始。Step 4（数据迁移）可并行/前置，见末尾。

## 当前分支与状态

- 分支：`feat_refactor_2`（主分支 `main`）
- 已完成且**已验证**：29/29 测试通过；`tsc -p tsconfig.node.json` 在所有新文件上 0 error。
- **未提交**（工作区改动，按 `git status --short`）：
  - ` M  electron/db/connection.ts`（测试 seam，生产无感）
  - `??  electron/services/scheduled-task-scheduler.ts`
  - `??  electron/services/scheduled-task-service.ts`
  - `??  electron/db/repositories/schedule-task-run-repository.ts`（本会话为其新增 `getActiveRun` / `cancelAllActiveRuns`）
  - `??  tests/db/`（helpers + 2 个测试文件）
  - `??  vitest.db.config.ts`
  - 另有同分支更早创建的未跟踪文件（`schedule-task-repository.ts`、`models/domain|dto|tables/schedule-task*.ts`、`migrations/0006-schedule-tasks.ts`、`docs/sqlite/schedule-tasks.md` 等）属本重构前序工作，已就绪。

## 已建成的公共面（精确符号 + 行号）

### `electron/services/scheduled-task-scheduler.ts`
```
export interface ScheduledTaskScheduleSnapshot        // line 30
export interface ScheduledTaskDispatcher {            // line 41
  dispatch(params: { task: ScheduleTask; run: ScheduleTaskRun }): Promise<void>;
}
const noopDispatcher: ScheduledTaskDispatcher = { ... }   // line 45 — 当前默认，**不执行任何东西**
export function computeNextRunAt(expr, from: Date): string  // line 138 — 本地时区，ISO-UTC 存储
export function validateCronExpr(expr: string): void      // line 153
export class ScheduledTaskScheduler {                       // line 158
  constructor(taskRepo, runRepo, dispatcher = noopDispatcher)  // line 165
  start(): void                  // line 169 — **已实现但未被任何 app 启动调用**
  stop(): void                   // line 175
  async refreshSchedule(now?): Promise<ScheduledTaskScheduleSnapshot[]>  // line 189
  async discardMissedOnStartup(now?): Promise<boolean>    // line 230
  async tick(now?): Promise<void>                          // line 269 — 单飞 claim：每 tick 至多 dispatch 一个到期 run
  async triggerTaskNow(taskId, now?): Promise<ScheduleTaskRun>  // line 316 — 已有 active run 时抛错
}
```

### `electron/services/scheduled-task-service.ts`
```
export class ScheduledTaskService {                         // 引擎无关报表层
  constructor(taskRepo?, runRepo?, scheduler?, catalogRepo?)  // 全部可选，生产用默认单例
  async createTask(input): Promise<ScheduleTask>             // line 58  — 校验+默认值+refresh
  async updateTask(id, input)                                // line 67
  async deleteTask(id, actor?)                               // line 89  — 软删+refresh
  async setEnabled(id, enabled, actor?)                     // line 94
  async listTasks()                                          // line 100
  async getTask(id)                                          // line 104
  async ensureDatedSessionPlaceholder(task, date)           // line 127 — cron→'cron' / claude→'claude_task'
  buildExecutionSystemPromptAppend(task): string | null      // line 145 — 仅当收件人已解析时烘焙「指定即必发」
}
export function getScheduledTaskService(): ScheduledTaskService  // 单例（仅定义，**未被引用**）
export { DINGTALK_RECIPIENTS_MARKER, hasResolvedDingTalkMentions }
```
**文件头注释（line 27–31）明确路线图**：Step 3 不接生产 → Step 4 数据迁移 → Step 5 接执行器（`runMainChatSend`）。

### 仓储已具备的方法（Step 5 直接复用，无需新建）
- `schedule-task-run-repository.ts`：`getRun` / `getByIdempotencyKey` / `listRuns` / `getLatestRun` / `getActiveRun`（新）/ `cancelAllActiveRuns`（新）/ `createRun` / **`updateRun`**（line 210，通用更新——finalization 用它，无专用 `markRunDone/markRunFailed`）
- `schedule-task-repository.ts`：`getById` / `list` / `create` / `update` / `softDelete` / `setEnabled` / `updateScheduleState`

## Step 5 要做的事（执行接线）

### 5.1 实现真正的 dispatcher（替换 `noopDispatcher`）
- `ScheduledTaskDispatcher.dispatch({ task, run })` 是唯一接缝。实现一个 `EngineScheduledTaskDispatcher`：
  - 按 `task.engineType`（`'openclaw' | 'claude'`）分发到对应引擎执行路径。
  - 用户选中 service line 31 的 `runMainChatSend` —— 这是 chat 引擎的执行入口，**优先确认它的签名/位置**（`grep -rn "runMainChatSend" electron/src electron/services`），它大概率接收 `(agentId, prompt, systemPromptAppend?, recipients?, permissionProfile?, timeoutSec?)` 之类。
  - 把 `buildExecutionSystemPromptAppend(task)` 的结果作为 system prompt append 传入。
  - `triggerSource`：`'manual'`（triggerTaskNow）或 `'schedule'`（tick）或 `'recovery'`（discardMissedOnStartup 重放）—— 体现在 `run.triggerSource`，dispatcher 可据此决定是否走幂等路径。

### 5.2 run 生命周期闭环（dispatch 完成后）
- 成功：`runRepo.updateRun(run.runId, { status: 'succeeded', finishedAt: new Date().toISOString() })` + 重置/递增 task 的 `consecutiveFailures`（失败计数清零）。
- 失败：`updateRun({ status: 'failed', finishedAt, errorMs? })` + `task.consecutiveFailures += 1` + 命中 `failurePolicy.pauseAfterConsecutiveFailures` 时 `taskRepo.setEnabled(id, false)` 或置 pause 状态。
- **重试策略** `retryPolicy { maxAttempts, backoffSec }`：失败时若未达 maxAttempts，重新 `createRun`（triggerSource='recovery'）+ `updateScheduleState` 推后 backoffSec。
- 事件下沉：参考 claude 家族 `setEventSink(gm)`（`main/index.ts:588`），把 run 状态变更 stream 给 renderer。

### 5.3 接入 app 启动（`electron/main/index.ts`）
- 参考 claude 家族在 `main/index.ts:584–594` 的写法：
  ```
  const claudeScheduledTaskService = getClaudeScheduledTaskService();   // line 585
  claudeScheduledTaskService.setEventSink(gm);                           // line 588
  claudeScheduledTaskService.startScheduler();                           // line 589
  void claudeScheduledTaskService.refreshSchedule().catch(...);          // line 590
  ... stopScheduler()                                                    // line 594
  ```
- 为通用调度器新增等价块：`const svc = getScheduledTaskService();` → `svc.start()`（内部 setInterval 调 `tick`）→ `await svc.discardMissedOnStartup()` → `svc.stop()` 于退出。
- **确认 `start()`/`stop()` 内部实现**（scheduler line 169/175）：是否已有 setInterval 驱动 `tick`，还是只空壳——若空壳需补 loop。

### 5.4 IPC 路由（UI 侧 CRUD + 立即运行）
- 镜像 `electron/api/routes/claude-scheduled-tasks.ts`（其 line 103 已调用 `getClaudeScheduledTaskService().refreshSchedule()`），为通用 service 建一套路由：`list`/`create`/`update`/`delete`/`setEnabled`/`triggerNow`。
- 在路由层把 `triggerTaskNow` 的 "已有 active run" 抛错转成 409/友好提示。

### 5.5 单飞 & 幂等约束（接线时务必遵守）
- `tick` 每 tick **只 claim 一个**到期 run（`getActiveRun` 守卫）——dispatcher 不可并发同 task。
- `createRun` 的 `idempotencyKey = buildIdempotencyKey(taskId, triggerSource, scheduledFor)`——recovery 重放必须用 `triggerSource='schedule'`，否则 key 不一致会重复创建。
- `discardMissedOnStartup` 已实现「重算过去 nextRunAt + cancel 残留 active run + 置 lastRecoveredAt」；接线时它**先于** start()。

## 关键坑（已踩/已验证，别再踩）

1. **Cron 是本地时区**：`computeNextRunAt`/`matchesCron` 用 `getHours()`/`getMinutes()`（本地），存 `toISOString()`（UTC）。`0 9 * * *` 在 UTC+8 机器上 = `01:00:00Z`。测试断言**时区无关的相对量**（如 hour 9→10 = +1h delta），不要写死绝对 UTC。运行环境时区见日志前缀 `+08:00`。
2. **`updateTask` 的空值守卫用 `!= null`**（line 71–79），不能用 `!== undefined`——`permissionProfile|retryPolicy|failurePolicy` 都是 `| null` 可空，`!== undefined` 只窄化 undefined，会让 null 漏进 assert 方法触发 TS2345（已修）。
3. **dispatcher 默认是 noop**：调度器全建好了但 `dispatch` 不做任何事。在注入真实 dispatcher 前，`start()`+`tick` 只会 claim run 然后……什么也不发生（run 停在 queued）。Step 5.1 必须先做。
4. **生产仍走 claude 家族**：`main/index.ts:584` 和 `routes/claude-scheduled-tasks.ts` 引用的是**旧的** `getClaudeScheduledTaskService`（hyphenated `claude-`），不是新的通用 `getScheduledTaskService`。两者并存，迁移期不要混用。

## 参考实现（同构旧家族，照抄模式即可）
- `electron/services/claude-task-scheduler.ts`：`setEventSink`(140) / `tick`(245) / dispatch 日志(258) / worker loop(296) / `refreshSchedule`(151) / `discardMissedOnStartup`(194) —— **这是通用 `ScheduledTaskScheduler` 的镜像，几乎所有模式直接对应**。
- `electron/services/claude-scheduled-task-service.ts`：CRUD/校验/默认值/refresh 模式（service 头注释点名复用锚点）。
- `shared/dingtalk-mention-context.ts` 的 `buildDingTalkMentionSystemContextForScheduledTask`（scenario='scheduled-task'，「指定即必发」）。

## Step 4（数据迁移，可前置）
- 把现有 claude 定时任务行迁入通用 `schedule_tasks` 表（`migrations/0006-schedule-tasks.ts` 已建表）。
- 或双轨并行：claude 家族继续跑、通用家族逐步接管，迁移完成后再切。
- 见 `docs/sqlite/schedule-tasks.md`（本重构前序设计文档）。

## Step 5.1 落地（执行器 + 引擎无关接线）— 已完成

- 新增 `electron/services/scheduled-task-executor.ts`：`EngineScheduledTaskDispatcher implements ScheduledTaskDispatcher`。编排 `queued→running→succeeded/failed` 全程，把引擎细节下沉给 `runMainChatSend`：构造 `MainChatSendInput`（`sessionKey` / `message` / `idempotencyKey` / `deliver=true` / `permissionProfile` / `systemPromptAppend` / `engineType`），把 `adapter.prepareMemoryInjection` 和 `adapter.sendMessage` 作为**回调闭包**传入（不在执行器内硬调 claude 引擎）。`getAdapter(task.engineType)` 取引擎无关 adapter，天然多引擎。
- `scheduled-task-service.ts` 加 `setGatewayManager(gm)`：注入 `gatewayManager` 并把执行器注册到 `scheduler.setDispatcher(...)`。闭包注入 `getGatewayManager` / `ensureDatedSession` / `buildSystemPromptAppend`，避免 service↔executor 循环 import，sessionKey 构造与 dingtalk 烘焙仍归 service 单一职责。
- 安全语义：`gatewayManager` 未注入时 `getGatewayManager()` 返回 `null`，执行器在 dispatch 入口即判失败（`run.status=failed`、写 error），**不调** `runMainChatSend`、**不写** `runtimeResult`（startedAtMs 未设）——避免在 gateway 就绪前误触发引擎。
- 测试：`tests/db/scheduled-task-executor.test.ts`（5 例，`vi.mock` `chat-send-service` 控 send 结果 + 捕 input 塑形）。覆盖 gateway 未注册→failed、send 成功→succeeded（含 input 全字段断言）、run 已带 sessionKey 复用、send 非成功→failed、send 抛错→failed。全量 `tests/db` 34/34 通过。
- tsc：`scheduled-task-executor.ts` / `scheduled-task-service.ts` 及其引用符号（`getAdapter` / `MainChatSendInput` / `runMainChatSend` / `setDispatcher` / `setGatewayManager`）**0 error**。分支基线仍有 103 条 engines 重构在途错（`EngineSessionSummary`→`Record<string,unknown>` 类型迁移、plugin tsconfig），与本步骤无关，归 engines 重构轨道。
- 未接生产（5.1 时点状态）：`setGatewayManager` 尚未在 `main/index.ts` 启动序列调用（Step 5.3）；IPC 路由也未接（Step 5.4）。执行器对旧 claude 家族零影响。

## Step 5.2–5.5 落地 — 已完成

- **5.2 run 生命周期闭环**：`EngineScheduledTaskDispatcher.dispatch` 内编排 `queued→running→succeeded/failed` 全程（`markRunRunning` / `markRunSucceeded`/`markRunFailed`），`runtimeResult` / `error` 落库；`retryPolicy` / `failurePolicy` 在 executor 分支判定；完成事件经 `setEventSink` 下沉。见 `scheduled-task-executor.ts` + `tests/db/scheduled-task-executor.test.ts`。
- **5.3 接入 app 启动**：`electron/main/index.ts:600` 调 `getScheduledTaskService()` + `setGatewayManager(gm)`（注入执行器并 `setDispatcher`），随后 `startScheduler()`——`discardMissedOnStartup().finally(start)` 保证清残留 lease 先于首个 tick。gateway 就绪前 `getGatewayManager()` 返回 null，执行器入口即判失败、不触引擎。
- **5.4 IPC 路由**：新增 `electron/api/routes/scheduled-tasks.ts`（镜像 `claude-scheduled-tasks.ts` 结构，收窄到 `list`/`create`/`get`/`update`/`delete`/`set-enabled`/`trigger`）。`server.ts` 注册 `handleScheduledTaskRoutes`。`trigger` 的 "already has an active run" 抛错在路由层转 409 + 友好提示；service 在 create/update/delete/setEnabled 后已自调 `refreshSchedule`，无需额外 `/refresh` 路由。
- **5.5 单飞 & 幂等约束（核对，已满足，未改代码）**：
  - 单飞 ✅ `claimRun` → `runRepo.getActiveRun(task.id)` 守卫（`scheduled-task-scheduler.ts:349`），active run 在即返回 null。
  - 幂等键 ✅ `buildIdempotencyKey(task.id, 'schedule', scheduledFor)`（`:359/:381`），tick 用 `triggerSource: 'schedule'`（`:299`），recovery 重放 key 一致。
  - 顺序 ✅ `discardMissedOnStartup()` 先于 `start()`（`startScheduler` 的 `.finally(start)`）。
- **已知限制（不本步修，留后续）**：generic 调度器 lease 是 **status-based**（`schedule_task_runs.status ∈ {queued,running}` 即 active，无时间分量，见 scheduler 头注释 `:15-17`），而旧 claude 家族是 **time-based lease**（`leaseUntil > now`，`claude-task-scheduler.ts:225`）。后果：长会话中若 dispatched run 永久挂起（引擎不回调、进程不重启），`running` 行不释放，`getActiveRun` **永久阻塞该 task 的后续 claim 直到重启**——claude 靠 lease 过期自愈，generic 不能。闭合方案：后续在 tick 内加 stale-run reaper（用已有 `timeout_sec` 字段判定 `started_at` 超时→finalize 为 failed 释放单飞），镜像 claude 运行期 lease 自愈。本步骤按决策仅文档化，未新建代码。

  **【2026-07-24 已落地】** `ScheduledTaskScheduler.reapStaleRuns` 已在 `tick` 入口先于 claim 调用：`runRepo.listActiveRuns()`（新增）筛全部非终态 run，`running` 且 `started_at + task.timeout_sec < now` → `updateRun({ status: 'timed_out', completedAt, error, runtimeResult })` 释放单飞；`queued`（无 startedAt）与 `timeoutSec=null` 的任务不 reap。reaped run 不走执行器重试/pause 路径（scheduler 不耦合 executor 的 event sink / recovery 编排），pause-on-timeout 留后续。测试见 `tests/db/scheduled-task-scheduler.test.ts` 的 `tick (stale-run reaper)` 3 例。

## 快速验证命令（新会话起步自检）
```
npx vitest run --config vitest.db.config.ts        # 期望 43/43 通过
npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep -iE "scheduled-task|tests/db|connection"  # 期望无输出
grep -rn "getScheduledTaskService" electron --include="*.ts"   # Step 5 接线后：应出现在 main/index.ts + api/routes/scheduled-tasks.ts（+ service.ts 定义）
```

## 后续工程：croner 替换 + claude 引擎退役（双双延后）

**决策（2026-07）**：croner 替换（Part A）与 claude 调度引擎退役（Part B）**双双延后**，待「重构轨道结束 + Step 4 数据迁移（definitions.json→schedule_tasks 等）完成」之后再考虑。本阶段**不动**现有 cron math、不删 claude 引擎、保持双跑。

### Part A — croner 替换自研 cron math（可行，低风险，延后执行）
- croner v10.0.1（零依赖 6.8KB，2026-02 发布、6 月仍活跃 dev）。`new Cron(expr).nextRun(from)` 无 callback 不起定时器 → 纯计算，可 drop-in 替换 `computeNextRunAt`。
- 唯一适配：`validateCronExpr` 现靠 366 天扫描抛错挡 `0 9 31 2 *`；croner `nextRun()` 对永不命中返 `null` → 包一层 `if null throw` 即可。
- 时区：当前引擎 host-local（`getHours`）；croner 不传 `timezone` 也回退 host-local → 行为一致。per-task 时区是未来升级（需 schema 列），替换时保持 host-local 不改语义。
- DOM+DOW：两边都 Vixie OR，croner 默认也 OR → 一致。
- **重复 cron math**：`claude-task-scheduler.ts:21-114` 与 `scheduled-task-scheduler.ts:53-156` 是**两份逐字重复**，外加 1 个外部消费者 `electron/utils/advance-openclaw-cron-next-runs.ts:5` 从 claude 版导入 `computeNextRunAt`。落地时抽成**共享 cron util**（croner 包装），三处统一导入 → 一次性退役两份重复 + 跨文件引用。

### Part B — claude 调度引擎退役（被阻塞，延后执行）
claude 引擎**不是死代码**，是双跑中的生产在用路径（`main/index.ts:584-594` boot + `server.ts:96` 路由 + `claude-runtime-extensions` MCP 工具 + 前端 `src/stores/cron.ts` 全量调用）。删之前 4 个硬阻塞 + 附带项：
1. **数据迁移（Step 4，从未执行）**——claude 任务存本地 JSON（`definitions.json`/`runs/*.jsonl`/`sessions/`），不在 generic 的 SQLite `schedule_tasks` 表。直接删 → 用户 claude 任务和历史全丢。
2. **session-history**——generic 引擎不暴露 sessions/session-history/scheduler-status/refresh（`scheduled-tasks.ts:11-13` 注释明说 claude 专属）；前端 `virtual-task-history.ts`/`cron-session-utils.ts` 在用 → 删了前端断。
3. **workflow watchdog / dws-send 兜底**（`claude-task-workflow-watchdog.ts`）——超时钉钉沉默修复 + 非 workflow 结果兜底；generic executor 走 `runMainChatSend` 无 watchdog → claude 长流程任务超时会**回归到钉钉沉默**。
4. **Claude 会话内 MCP 工具**（`sto-plugin/claude/claude-scheduled-task-tool`）——Claude 管自己定时任务的唯一入口，generic 无对应。
5. 附带：lease 模型不同（claude 时间 lease 自愈 vs generic status lease 卡到重启——见上「已知限制」），cutover 前应加 stale-run reaper；+ ~9 处后端 call site 重接（`main/index.ts`、`server.ts`、`claude-runtime-extensions.ts`、`session-engine.ts`、`sessions.ts`、`advance-openclaw-cron-next-runs.ts`、`reset-dated-execution-record.ts`、`task-execution-session-model.ts`、`paths.ts`）+ 前端重做 + 执行路径 parity 验证（`consumeClaudeQuery` vs `runMainChatSend` 的 memory injection / plugin path / permission profile）。

### 复用锚点（延后执行时照此）
- claude 引擎完整文件清单：`claude-scheduled-task-service.ts` / `claude-scheduled-task-store.ts` / `claude-scheduled-task-session-store.ts` / `claude-task-scheduler.ts` / `claude-task-worker.ts` / `claude-task-runtime-builder.ts` / `claude-task-workflow-watchdog.ts` / `api/routes/claude-scheduled-tasks.ts` / `sto-plugin/claude/claude-scheduled-task-tool/{tools,hooks}.ts` + 对应 `tests/unit/claude-*`。
- generic 引擎已就位：CRUD + trigger + cron 调度 + 引擎无关执行（含 `engineType:'claude'` 分支）+ 事件下沉 + 重试/失败策略；Step 5.1–5.5 全绿。缺的就是上面 4 个 claude 专属能力 + Step 4 数据迁移。
