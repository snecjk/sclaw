# 定时任务执行流与普通聊天 SSE 流一致性 — 开发计划

> 状态：**待执行**。本稿审阅通过后，按 Phase 0→5 推进。

## 1. 背景与目标

### 1.1 目标

让 **Claude / OpenClaw 两种引擎的定时任务执行**与**普通聊天对话**走同一条流式事件管道，达到：

- 执行期间用户能看到思考过程 / 工具调用 / 流式输出（前台 + 后台）；
- 侧栏对应会话显示 loading；
- 执行结束（不在前台时）侧栏出现未读红点；
- 执行失败显示错误态；
- 两种引擎在上述四点上**行为一致**。

### 1.2 "SSE 流"的语义对齐

本仓**已有**一条统一流式管道：主进程 `gm.on('chat:message')` → `HostEventBus.emit('gateway:engine-event')` / `broadcast('gateway:engine-event')` → 渲染进程 `subscribeHostEvent('gateway:engine-event')`（[host-events.ts](src/lib/host-events.ts)），传输层默认走 IPC，并带 **SSE fallback**（`stoclaw:allow-sse-fallback=1` 开启 `EventSource`）。

因此"SSE 流一致"≠ 新建 per-run HTTP SSE 端点，而是：**让两种任务执行的事件都正确路由进这条既有管道**，并保证 SSE fallback 通道与 IPC 通道行为对等。普通聊天与 Claude 任务已走通；本计划聚焦把 OpenClaw 任务也对齐，并补齐两类引擎共有的健壮性缺口。

## 2. 现状（已核实）

### 2.1 传输管道（已统一，两引擎共用）

```
[Gateway / Claude worker]
   └─ gm.emit('chat:message', { engineEvent })
        └─ main/index.ts:703  heb.emit('gateway:engine-event', sanitize(...))
        └─ ipc-handlers.ts:1580 broadcast('gateway:engine-event', enrich(...))   ← 双注册，由 gatewayEventDeduper 去重
             └─ preload IPC  →  renderer subscribeHostEvent
             └─ EventSource (SSE fallback)
                  └─ handleGatewayEngineEvent → handleChatEvent
```

`shouldProcessGatewayEvent`（[gateway.ts:47](src/stores/gateway.ts#L47)）仅做去重，**不按 sessionKey 过滤**。事件能否进 `handleChatEvent` 只取决于去重，路由完全靠 `mapEventSessionKey` 解析出的 `resolvedSessionKey`。

### 2.2 路由分流（[foreground-event-actions.ts:148](src/stores/chat/foreground-event-actions.ts#L148)）

- `resolvedSessionKey === currentSessionKey` → 前台路径（流式写入当前会话）；
- `resolvedSessionKey != null && !== currentSessionKey` → 后台路径 `handleBackgroundSessionEvent`（[background-session-events.ts](src/stores/chat/background-session-events.ts)）：`noteObservedRun` + 流式写入该会话 runtime + 完成时 `markSessionUnreadAfterSuccessfulRun`。

后台处理器**与引擎无关**，对任意 sessionKey 都生效。

### 2.3 两种引擎的 sessionKey 发射差异（核心根因）

| 引擎 | started 事件 sessionKey | delta/final 事件 sessionKey | run key 出现？ | 后台是否一致 |
|---|---|---|---|---|
| Claude | `claude-task-run:{taskId}:{runId}` | `claude-task-run:{taskId}:{runId}` | 是（全程） | ✅ `getClaudeTaskRunSessionAggregateKey` 一致映射到 dated |
| OpenClaw | `agent:{a}:cron:{jobId}:{date}`（dated） | `agent:{a}:cron:{jobId}`（**base**） | **否** | ❌ base 与 dated 不一致 |

Claude worker 在 [claude-task-worker.ts:439](electron/services/claude-task-worker.ts#L439) 用 `buildClaudeTaskRunSessionKey` 全程发 run key，故 `getClaudeTaskRunSessionAggregateKey`（[cron-session-utils.ts:192](src/stores/chat/cron-session-utils.ts#L192)）稳定映射到"今天的 dated"，前台/后台都通。

OpenClaw Gateway 对 `started` 发 dated、对 `delta`/`final` 发 **base** key。`mapEventSessionKey`（[session-event-routing.ts:21-30](src/stores/chat/session-event-routing.ts#L21-L30)）只在一个条件下把 base 映射回 dated：**当前会话恰好是同 jobId 的 dated 会话**。

### 2.4 OpenClaw 后台 bug 推演（已用 `decideRunEvent` 复核）

用户不在该 cron 会话时：

1. `started`（dated）→ 后台在 **dated** 会话 bindRun、设 `activeRunId`、`noteObservedRun` ✅
2. `delta`（base）→ 当前非 cron → base 不被映射 → 后台在 **base** 会话跑 `decideRunEvent`：base 会话无 `activeRunId`（绑在 dated）、state 非 `started` → **`reject: orphan-event`** ✗ → 丢
3. `final`（base）→ 同 delta → **丢**，`markUnreadAfterSuccessfulRun` 不触发 → **无红点** ✗

副作用：started 设了 `sending:true` 在 dated 会话却永远等不到 final → **侧栏该会话卡 loading**。

> 前台（用户正看该会话）能用，正是因为 base 撞上"current 是同 jobId dated"的映射分支。

### 2.5 未读门禁（[session-unread-notify.ts](src/lib/session-unread-notify.ts)）

三重门禁：A. run 已观测（`noteObservedRun` 在 started/delta 调用过）；B. 启动 5s 宽限；C. 近期 20s 已读。后台处理器在 `started`/`delta` 已调 `noteObservedRun`，故只要 final 能落到 dated 会话，红点即可打。

## 3. 差距清单

| ID | 差距 | 引擎 | 优先级 | 影响 |
|---|---|---|---|---|
| G1 | base key 未归一成"今天 dated"，后台 delta/final 被当 orphan 丢 | OpenClaw | **P0** | 后台无流式 / 卡 loading / 无红点 |
| G2 | 定时（非手动）触发的 run，dated 会话在 run 期间不在侧栏列表里 | OpenClaw | P1 | 即使 G1 修好，侧栏看不到 loading（会话未实例化） |
| G3 | 缺少"卡 loading"兜底：started 后 final 永不到达 → 永久 sending | 两引擎 | P1 | 异常态视觉残留 |
| G4 | 任务失败事件（error/turn.failed）在后台路径下是否落到 dated 未验证 | 两引擎 | P1 | 失败态可能不显示 |
| G5 | SSE fallback 通道与 IPC 通道行为未对等验证 | 两引擎 | P2 | SSE 模式下可能丢事件 |
| G6 | Claude 关机错过丢弃（已实现），OpenClaw 关机期间 Gateway 行为未确认 | OpenClaw | P2 | 重启后可能残留 stale loading |

## 4. 实施阶段

### Phase 0 — 基线测量与埋点（不动逻辑）

- [ ] 渲染进程开启 `logChatFlow` 事件日志采集，手动 + 定时各触发一次 OpenClaw / Claude 任务，记录前台/后台两类场景下 `event.foreground.normalized` / `event.background.route` / `event.run.rejected`。
- [ ] 确认 OpenClaw **定时**（Gateway cron tick，非 `cron.run force`）触发时，Gateway 发出的 event 类型/sessionKey 是否与手动触发一致（验证 G1 修复对定时也生效）。
- [ ] 确认 Claude 任务后台场景前台/后台均通（作为对照基线）。
- [ ] 产出：每个场景的"事件序列 + resolvedSessionKey + decision.reason"表，作为 Phase 1 后回归对照。

### Phase 1 — OpenClaw base key 归一（G1，核心修复，~5 行）

**改 [cron-session-utils.ts](src/stores/chat/cron-session-utils.ts)**，新增 helper（镜像 `getCronRunSessionAggregateKey`，但作用于 base key）：

```ts
/** Map a cron BASE key (agent:*:cron:* — no date, no run) to today's dated aggregate. */
export function getCronBaseSessionTodayDatedKey(sessionKey: string): string | null {
  const parsed = parseCronSessionKey(sessionKey);
  if (!parsed || parsed.date || parsed.runSessionId) return null;
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `agent:${parsed.agentId}:cron:${parsed.jobId}:${y}-${m}-${d}`;
}
```

**改 [session-event-routing.ts](src/stores/chat/session-event-routing.ts)**，在 run-key 映射之后、现有 base 分支之前插入：

```ts
const baseAggregateKey = getCronBaseSessionTodayDatedKey(eventSessionKey);
if (baseAggregateKey) return baseAggregateKey;
```

现有 21-30 行的 base→current 分支可保留作兜底，也可删除（新映射已覆盖 viewing 场景；且新映射修正了"看昨天 dated 会话时今天的 run 内容串到昨天"的同类 bug）。

> Claude 侧对称可选：若 Phase 0 发现 Claude 也有 base key 发射（理论上不会，worker 全程用 run key），再加 `getClaudeTaskBaseSessionTodayDatedKey`。

**预期**：OpenClaw started/delta/final 全部落到同一 dated 会话，后台 `decideRunEvent` 全 accept → 流式 + loading 清除 + 未读红点全通。

### Phase 2 — 定时触发的会话预实例化（G2）

OpenClaw 定时（非手动）触发时，前端没有 `handleTrigger` 的预建会话逻辑，dated 会话要等 run 完成后由 [cron.ts:425](electron/api/routes/cron.ts#L425) 虚拟会话合成才进列表 → run 期间侧栏看不到 loading。

- [ ] 在后台路径 `started` 分支（[background-session-events.ts:80](src/stores/chat/background-session-events.ts#L80)）增加：若 `resolvedSessionKey` 是 cron/claude dated key 且不在 `sessions` 列表中，复用 [first-trigger-placeholder-session-key.ts](shared/first-trigger-placeholder-session-key.ts) 机制合成一个占位会话条目（只含 sessionKey + agentId + 引擎类型 + runtime），让侧栏立即出现该会话与 loading。
- [ ] run 完成后 `loadSessions` / 虚拟会话合成会覆盖占位条目为真实 transcript，保证不重复。
- [ ] 手动触发路径（MyTask `handleTrigger` 已有 `markScheduledSessionActivating`）保持不变。

### Phase 3 — 健壮性兜底（G3 / G4）

- [ ] **G3 卡 loading 兜底**：在 `runtimeBySessionKey` 上加 watchdog——某会话 `sending:true` 且 `activeRunId` 对应的 run 超过 N 秒（建议 90s，可配）无任何 `delta`/`final` 事件、且该 runId 已 `recordTerminalRun` 或从未再被观测 → 自动清 `sending`/`activeRunId`。放 `runtime-timers.ts` 侧，不动正常路径。
- [ ] **G4 失败态路由**：构造一次 Claude `turn.failed` 与 OpenClaw error 事件（可 mock），验证 `error` 状态在后台路径下落到 dated 会话、显示错误图标、清 `sending`。若 base key 归一未覆盖 error 事件（eventSessionKey 可能又是 base），Phase 1 的映射已一并修复；Phase 0 埋点确认。

### Phase 4 — SSE 通道对等（G5，可选）

- [ ] 开启 `stoclaw:allow-sse-fallback=1`，重跑 Phase 0 全部场景，比对 IPC 与 SSE 两通道下事件序列一致。
- [ ] 若 SSE 通道丢事件：检查 [host-api.ts](src/lib/host-api.ts) 的 `createHostEventSource` 重连/缓存策略，补齐与 IPC `broadcast` 等价的 at-least-once + deduper 兜底。
- [ ] 决策：是否将 SSE 升级为任务流的**主通道**（解耦 Gateway 进程生命周期、便于无 Electron 环境复用）。默认维持 IPC 主、SSE 备，仅在本阶段评估。

### Phase 5 — 验收与交付

- [ ] `pnpm typecheck` / `pnpm lint`。
- [ ] 全仓搜无残留：base key 未归一的旧路径无引用。
- [ ] 跑验收矩阵（见 §5）全部 ✅。
- [ ] 在本文件追加"执行记录"小结。

## 5. 验收矩阵

| 场景 | 引擎 | 前台 loading | 前台流式 | 后台 loading | 后台红点 | 失败态 |
|---|---|---|---|---|---|---|
| 普通聊天 | OpenClaw | ✅(基线) | ✅(基线) | n/a | n/a | ✅ |
| 普通聊天 | Claude | ✅(基线) | ✅(基线) | n/a | n/a | ✅ |
| 手动触发任务 | OpenClaw | ✅ | ✅ | ✅ | ✅ | ✅ |
| 手动触发任务 | Claude | ✅(已有) | ✅(已有) | ✅(已有) | ✅(已有) | ✅ |
| 定时触发任务 | OpenClaw | ✅ | ✅ | ✅ | ✅ | ✅ |
| 定时触发任务 | Claude | ✅(已有) | ✅(已有) | ✅(已有) | ✅(已有) | ✅ |

> "已有"= 现状已满足；其余为本计划交付目标。

## 6. 风险与回滚

- **base key 归一改动面小但位于事件路由核心**：全程只新增映射、不删既有分支（先保留 21-30 行兜底），回归风险低；Phase 0 埋点提供前后对照。
- **Phase 2 占位会话可能与真实合成重复**：占位条目必须能被 `loadSessions` 的虚拟会话合成无 merge 冲突地覆盖；用 sessionKey 做去重主键。
- **Phase 3 watchdog 误清正常长任务**：N 秒阈值需 ≥ 工作流任务典型时长（Claude 工作流默认 1800s 超时，watchdog 只盯"无任何 delta"而非"未完成"，长任务只要还在发 delta 就不清）。
- **回滚**：所有改动集中提交，`git revert` 即可；Phase 1 单独可先行合入（独立价值）。

## 7. 执行记录

（待 Phase 完成后填写）
