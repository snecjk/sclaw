# Claude 引擎未读 / 已读方案设计（非实现版）
## 0. 思考过程一致性分析（定时任务 vs 普通聊天 × OpenClaw vs Claude）

在讨论未读/已读/执行中状态之前，先回答一个前置问题：**定时任务执行时触发的对话，和用户手动发起的普通聊天对话，其"思考过程"（thinking / reasoning / streaming）是否走同一条链路？**

### 0.1 事件链路总览

| 场景 | 触发入口 | 事件流路径 | 渲染进程接收方式 |
|---|---|---|---|
| OpenClaw 普通聊天 | 用户在 Chat 页发送消息 | Gateway WebSocket RPC → `gateway:notification` / `gateway:engine-event` | `subscribeHostEvent` → `handleChatEvent` |
| OpenClaw 定时任务 | 云端 cron 触发 | **不经过 Gateway 事件流**；由 `ScheduledTaskResultPoller` 轮询云端 API | `scheduled-task:new-result` IPC 事件 |
| Claude 普通聊天 | 用户在 Chat 页发送消息 | `claude-adapter.ts` → `consumeClaudeQuery` → `eventSink.emit('chat:message')` | `gateway:notification` / `gateway:engine-event` → `handleChatEvent` |
| Claude 定时任务 | `ClaudeTaskScheduler` cron tick | `claude-task-worker.ts` → **同样调用 `consumeClaudeQuery`** → `eventSink.emit('chat:message')` | `gateway:notification` / `gateway:engine-event` → `handleChatEvent` |

### 0.2 关键结论：思考过程是否一致

#### OpenClaw 引擎

- **普通聊天**：Gateway 实时推送 `turn.started` → `delta`（含 thinking / tool 块）→ `final` → `agent.completed`，渲染进程通过 `handleChatEvent` 走完整状态机，思考过程实时展示。
- **定时任务**：**不走 Gateway 事件流**。`ScheduledTaskResultPoller` 只在任务完成后轮询到结果，通过 `scheduled-task:new-result` IPC 通知渲染进程。执行期间没有 `started` / `delta` 事件，**思考过程不会展示**。
- **结论：OpenClaw 的定时任务和普通聊天在思考过程上不一致。** 定时任务期间用户看不到任何执行过程，只能在结束后看到结果。

#### Claude 引擎

- **普通聊天**：`claude-adapter.ts` 的 `consumeClaudeQuery` 通过 `eventSink`（GatewayManager EventEmitter）发出 `turn.started` → `message.delta`（text_delta）→ `message.final` → `agent.completed`，渲染进程走同一套 `handleChatEvent` 状态机。
- **定时任务**：`claude-task-worker.ts` **复用了同一个 `consumeClaudeQuery` 函数**，同样通过 `eventSink` 发出事件。事件最终经 `gm.on('chat:message')` → `heb.emit('gateway:engine-event')` → 渲染进程 `subscribeHostEvent('gateway:engine-event')` → `handleChatEvent`。
- **结论：Claude 的定时任务和普通聊天在思考过程上是一致的。** 两者走同一条 `consumeClaudeQuery` → `eventSink` → Gateway 事件流 → `handleChatEvent` 链路，定时任务执行期间用户也能看到思考过程、工具调用、流式输出。

#### 两种引擎的差异根因

| 维度 | OpenClaw | Claude |
|---|---|---|
| 定时任务执行器 | 云端执行，本地只轮询结果 | 本地 `ClaudeTaskWorker` 执行 |
| 是否复用聊天事件流 | 否（独立轮询路径） | 是（复用 `consumeClaudeQuery`） |
| 执行期间是否有 streaming 事件 | 无 | 有（`turn.started` / `delta` / `final`） |
| 思考过程是否展示 | 不展示 | 展示（与普通聊天一致） |
| sessionKey 格式 | `agent:{agentId}:cron:{taskId}:{date}` | `claude-task-run:{taskId}:{runId}` |

### 0.3 对未读/已读/执行中状态的影响

由于两种引擎在定时任务时的事件链路不同，未读/已读/执行中状态的 UI 显示策略也需要区分：

#### 现有未读打标机制（`session-unread-notify.ts`）

未读红点的打标逻辑位于 `markSessionUnreadAfterSuccessfulRun`，它有三重门禁：

1. **已观测 run**：`noteObservedRun(runId)` 必须在 `started` / `delta` 事件中被调用过，否则完成时不会打标。
2. **启动宽限**：App 启动后 5 秒内不打标（防重放）。
3. **近期已读**：会话最近 20 秒内被打开过则跳过。

- **Claude 定时任务**：由于走 Gateway 事件流，`started` / `delta` 事件会触发 `noteObservedRun`，所以完成时 `markSessionUnreadAfterSuccessfulRun` **能正常打标**。
- **OpenClaw 定时任务**：由于不走 Gateway 事件流，`noteObservedRun` **从未被调用**，所以完成时 `markSessionUnreadAfterSuccessfulRun` **永远跳过**——这就是 OpenClaw 定时任务结束后侧栏没有未读红点的根因。

#### 执行中状态（loading）

- **Claude 定时任务**：`turn.started` 事件会通过 `handleChatEvent` → `setRuntimePatch({ sending: true, activeRunId })` 设置运行态，侧栏显示 loading。任务结束后 `agent.completed` 触发 `finalizeOpenClawRunAfterAgentCompleted` 清除运行态。
- **OpenClaw 定时任务**：没有 `started` 事件，运行态不会被设置。用户只能通过 MyTask 页面的 `markScheduledSessionActivating` 手动触发 loading（仅限手动执行），定时触发时无 loading。

### 0.4 四种场景的 UI 显示策略对比

基于以上分析，四种场景的未读/已读/执行中状态应采用不同策略：

| 场景 | 执行中 (loading) | 未读 (红点) | 已读 | 失败 |
|---|---|---|---|---|
| OpenClaw 普通聊天 | ✅ Gateway `started` 事件驱动 | ✅ `agent.completed` 后自动打标 | ✅ 进入会话清除 | ✅ `error` 事件 |
| OpenClaw 定时任务 | ❌ 无 streaming 事件 | ❌ `noteObservedRun` 未调用，无法打标 | N/A | ❌ 无 error 事件 |
| Claude 普通聊天 | ✅ `turn.started` 事件驱动 | ✅ `agent.completed` 后自动打标 | ✅ 进入会话清除 | ✅ `turn.failed` 事件 |
| Claude 定时任务 | ✅ 复用 `consumeClaudeQuery`，有 `started` | ✅ `noteObservedRun` 被调用，可打标 | ✅ 进入会话清除 | ✅ `turn.failed` 事件 |

### 0.5 思考过程能否统一？

**结论：不能完全统一，但可以分层对齐。**

- **Claude 引擎**：定时任务和普通聊天的思考过程已经天然一致（都走 `consumeClaudeQuery`），无需额外改造。
- **OpenClaw 引擎**：定时任务在云端执行，本地无法获取 streaming 事件，思考过程无法实时展示。这是架构层面的限制，不是 UI 层面能解决的。

因此，未读/已读/执行中状态的 UI 策略应该：

1. **Claude 引擎**：直接复用现有 Gateway 事件流驱动的状态机，定时任务和普通聊天统一处理。
2. **OpenClaw 引擎**：定时任务需要一条独立的"完成通知 → 未读打标"路径，绕过 `noteObservedRun` 门禁（因为它的 runId 不在 observed 集合里）。

---
## 1. 背景

当前观察到的现象是：

- Claude 引擎任务开始时，渲染进程能看到运行态，侧栏会显示 loading；
- 任务结束时，虽然主进程已经有完成日志，但渲染进程没有把“结束后的状态”稳定地映射到会话的未读 / 已读状态；
- 这导致“任务已经跑完，但侧栏没有体现出‘有新内容 / 需要用户注意’”的体验缺口。

因此，需要把 Claude 引擎的会话状态从“仅运行中”扩展为：

- 运行中
- 已完成且有新内容（未读）
- 已完成且已被用户查看（已读）
- 已失败（错误态）

---

## 2. 目标

### 2.1 业务目标

让 Claude 引擎的会话行为与普通聊天会话的体验尽量一致：

- 用户看到任务启动时，知道它正在跑；
- 任务结束且产生了新内容时，能在侧栏体现为“未读”；
- 用户进入该会话后，未读状态自动清除；
- 若任务失败，则不把它当成“未读内容”，而是展示错误态。

### 2.2 技术目标

把“未读 / 已读”从单纯的 UI 视觉状态，提升为基于会话生命周期的明确状态机。

---

## 3. 方案原则

### 3.1 先区分“运行态”和“未读态”

这两个状态不能混为一谈：

- 运行态：表示当前任务还在执行；
- 未读态：表示任务已经结束，且有新的内容需要用户关注。

两者并行存在时，UI 可以同时显示：

- 右侧会话行显示 loading（运行中）；
- 任务结束后，若当前会话不在前台，则显示未读红点。

### 3.2 未读应基于“新内容产生”而不是“事件触发”

不建议直接把“任务结束”当成未读。更合理的是：

- 只有当任务完成且产生了新的会话内容时，才算“未读”；
- 如果任务失败、没有产出有效消息、或者内容已经被用户阅读过，则不应被标记为未读。

### 3.3 已读应由“进入会话”触发

当满足以下任一条件时，认为该 Claude 会话已读：

- 用户主动切换到该会话；
- 用户打开该会话详情页；
- 用户在会话内触发了“标记已读”动作。

---

## 4. 状态模型

建议把 Claude 引擎会话抽象为以下状态：

| 状态 | 触发条件 | UI 表现 |
|---|---|---|
| Idle | 无运行、无新内容 | 无 loading、无红点 |
| Running | 任务已启动但尚未完成 | 侧栏显示 loading |
| Completed-Unread | 任务已结束，且存在新内容，且当前会话非激活态 | 显示未读红点 |
| Completed-Read | 任务已结束，且该会话已被用户查看 | 无未读红点 |
| Failed | 任务执行失败 | 显示错误态/红点 |

### 4.1 关键判断逻辑

- 运行态由“任务开始事件”切入；
- 未读态由“任务结束 + 有新消息 / 新内容”切入；
- 已读态由“进入会话 / 切换会话 / 触发阅读动作”切出；
- 错误态由“最终状态为 failed”切入。

---

## 5. 具体规则建议

### 5.1 任务开始时

当 Claude 任务开始执行时：

- 标记该会话为 Running；
- 清空旧的错误态；
- 不要立即标记为未读。

### 5.2 任务成功结束时

当 Claude 任务成功结束，并且有新的输出内容时：

- 如果当前用户没有正在查看这个会话，则将其标记为未读；
- 如果当前用户正在看这个会话，则不标记未读，而是直接把它视为已读。

### 5.3 任务失败时

当 Claude 任务失败时：

- 不把它当成“未读”；
- 仅显示错误态；
- 侧栏可显示红点/告警图标，但语义不同于未读。

### 5.4 用户进入会话后

用户进入或激活该会话时：

- 清除未读标记；
- 关闭运行态；
- 保留历史消息和最终状态。

---

## 6. 推荐的数据模型

建议从现有会话状态基础上增加以下字段语义，而不是把一切都压进 loading：

- running：是否正在执行；
- unread：是否有未读新内容；
- error：最后一次执行是否失败；
- lastActivityAt：最后一次内容更新时间；
- lastReadAt：最后一次被用户阅读时间；
- lastRunStatus：最后一次任务状态。

### 6.1 关键判断公式

可将状态判断简化为：

- 如果 running = true → 显示 loading；
- 否则如果 error = true → 显示错误态；
- 否则如果 unread = true → 显示未读红点；
- 否则显示普通空态。

这能避免“loading 覆盖未读”或“错误态被误当成未读”的问题。

---

## 7. 事件流建议

建议由主进程在 Claude 任务生命周期中发出统一事件，渲染进程根据事件更新状态，而不是在多个地方各自做判断。

### 7.1 建议事件

- task.started
  - 说明任务已经开始；
  - 更新 running = true。

- task.finished
  - 说明任务已结束；
  - 带上 status、hasNewContent、sessionKey、runId。

- task.failed
  - 说明任务执行失败；
  - 更新 error = true。

- session.opened
  - 说明会话已被用户查看；
  - 更新 unread = false。

### 7.2 渲染进程处理原则

渲染进程只负责：

- 接收主进程事件；
- 更新 chat store / 会话 runtime 状态；
- 驱动侧栏 UI 展示。

不建议让渲染进程直接去猜“任务是否应该被标记未读”，而是把判断逻辑下沉到状态机里。

---

## 8. UI 体验建议

### 8.1 侧栏

- 运行中：显示 loading 图标；
- 成功结束且未读：显示红点；
- 失败：显示错误图标；
- 已读：不显示任何状态标记。

### 8.2 会话内

- 当用户进入会话后，未读红点立即消失；
- 若任务仍在运行，页面内仍可显示“正在执行…”；
- 如果任务失败，页面内可显示失败提示条。

---

## 9. 兼容性与边界情况

### 9.1 任务本身没有新内容

如果任务结束时没有生成任何有效输出：

- 不应标记为未读；
- 只保留运行态或错误态。

### 9.2 会话已打开

如果用户已经在当前会话中，任务结束后：

- 不应该再显示未读红点；
- 应直接视为已读。

### 9.3 页面刷新后

刷新后仍需要能恢复状态：

- 未读状态应从会话元数据或状态存储恢复；
- 不要依赖单次内存状态。

---

## 10. 推荐落地顺序

建议按下面顺序推进：

1. 先把 Claude 任务的 lifecycle 事件打通；
2. 再把运行态与完成态区分开；
3. 再增加“未读 / 已读”状态；
4. 最后补上失败态的视觉区别。

这样最容易避免“把所有状态都塞进 loading”的混乱。

---

## 11. 最终建议结论

对 Claude 引擎而言，最合适的方案不是“任务结束时直接显示红点”，而是建立一套明确的会话状态机：

- 运行中：loading；
- 成功且未读：未读红点；
- 已读：无标记；
- 失败：错误态。

这套语义最接近普通聊天的用户认知，也最容易和现有会话状态模型对齐。
