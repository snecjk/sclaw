## 计划
### 修复目标
让 Claude 定时任务"立即运行"创建的新会话能实时流式显示内容、并在运行结束时自动收尾，而不是一片空白、必须手动切走再切回才出现。

### 根因（已确认）
executeClaudeTask（electron/services/claude-task-worker.ts:36-178）直接 sdk.query(...)，只抠 lastAssistantText/runtimeResult，完全没有把 SDK 事件桥接到前端：无 eventSink、无 emit、无 includePartialMessages、不发 phase:'completed' 通知。所以渲染进程的 handleChatEvent（src/stores/chat.ts:2637）从不被调用，内容只能靠运行结束后"切换会话→loadHistory→buildHistory 读 SDK 落盘消息"被动捞取。

对比：交互式路径 claudeAdapter.sendMessage → consumeClaudeQuery（electron/engines/claude-adapter.ts:697-863）已通过 eventSink: ctx.gatewayManager 把 started/delta/final/completed 事件经 gateway 广播到渲染进程（commit 2bbb4cd）。定时任务这条链（ClaudeScheduledTaskService→ClaudeTaskScheduler→ClaudeTaskWorker→executeClaudeTask）从未注入 gatewayManager，而 gm 其实在 main/index.ts:472 就有、556 行已传给 hostApiServer。

### 方案
在 worker 的现有循环内镜像 consumeClaudeQuery 的事件发射逻辑，并把 gatewayManager（结构化 ClaudeEventSink）注入 service→scheduler→worker 链。不改 claude-adapter.ts、不改渲染进程——ClaudeEventSink 的文档注释（claude-adapter.ts:20-26）明确说明该事件桥就是为了让渲染进程现有状态机零改动处理。

### 文件改动
1. electron/services/claude-task-worker.ts（主改动）
   新增本地结构类型 ClaudeTaskEventSink = { emit(event: string, payload: unknown): boolean }（镜像 claude-adapter.ts:27-29，本地定义避免耦合）。
   ClaudeTaskExecutor 参数类型（:27-30）增加 eventSink: ClaudeTaskEventSink | null。
   executeClaudeTask（:36）从 params 取 eventSink：
   sdk.query options（:61-82）增加 includePartialMessages: true（拿 token 级 stream_event）。
   定义局部 emitChat/emitAgentCompleted（if (!eventSink) return; 守卫）+ seq 计数 + streamText 累加器，逐行镜像 consumeClaudeQuery（claude-adapter.ts:719-726,731,746-758,825-836,771,853,860），用 params.run.runId 与 params.run.sessionKey。
   循环前：emitChat({ state: 'started' })。
   循环内新增 message.type === 'stream_event' 分支（text_delta 累加 streamText，发 delta），continue。
   现有 assistant 分支（:112）：保留 lastAssistantText 提取，之后发 emitChat({ state:'final', message:{ id, role:'assistant', content, timestamp } }) 并 streamText=''。
   现有 result 分支（:129）：保留 runtimeResult 提取，之后 emitAgentCompleted()。
   用 try/catch/finally 包裹：catch 发 error 后 rethrow；finally 中若无 result 且无 error 发 aborted。
   所有现有 registry upsert、lastAssistantText/runtimeResult/status/summary 提取不变（run record 仍正确）。
   ClaudeTaskWorker 构造（:181）：把 eventSink: ClaudeTaskEventSink | null = null 作为第一个参数（在 executor 之前），使 new ClaudeTaskWorker(eventSink) 可用、executor 仍走默认。
   executePreparedRun（:241）：this.executor({ definition, run: runningRecord, eventSink: this.eventSink })。
2. electron/services/claude-task-scheduler.ts
   ClaudeTaskScheduler 构造（:118-121）：增加 eventSink 为第一个参数，传给 new ClaudeTaskWorker(eventSink)（worker 默认 executor 保留）；参数顺序保证 eventSink 在 worker 之前（默认参数左→右求值）。无位置式外部调用方（仅 service 内 new ClaudeTaskScheduler()）。
3. electron/services/claude-scheduled-task-service.ts
   ClaudeScheduledTaskService 构造（:165）：增加 eventSink 为第一个参数，传给 new ClaudeTaskScheduler(eventSink)。
   getClaudeScheduledTaskService 工厂（:270）：签名改为 (eventSink?: ClaudeTaskEventSink | null)，创建时传 eventSink ?? null。路由调用方（claude-scheduled-tasks.ts）仍无参调用 → 拿到 main 启动时已初始化的单例。
4. electron/main/index.ts（:546）
   getClaudeScheduledTaskService() → getClaudeScheduledTaskService(gm)。
   安全性 / 与现有代码一致
   发射逻辑是已验证的 consumeClaudeQuery 的忠实镜像 → 渲染进程 handleChatEvent（started/delta/final）与 scheduleCompletedRunFinalization（completed 后重载历史对齐落盘消息）零改动即可工作。
   eventSink 各处默认 null → 降级即今日行为（无流式但不崩）；gm 不可用时静默不发射。
   不碰 claude-adapter.ts → 交互式 Claude 对话零回归风险。
   ClaudeTaskExecutor 可注入 → 测试可传 mock executor/sink。
   事件只在 gm 上 emit chat:message/notification，现有 IPC 桥（ipc-handlers.ts:1633-1660）已就绪，无需新增 IPC 通道（符合 AGENTS.md 的 renderer/main API 边界约束）。
   不在本次范围（可作后续）
   liveClaudeMessages 缓存填充：因焦点保持、且 completed 前无中途回退 loadHistory，本次症状不需要；如需中途 reload 抗闪烁再考虑暴露该缓存或复用 consumeClaudeQuery。
   MyTask/index.tsx:257 OpenClaw BASE key→DATED key：独立 bug（用户已确认测的是 Claude）。
   验证
   pnpm run typecheck、pnpm run lint。
   手动：建一个 Claude 定时任务 → 立即运行 → 新会话应显示 started 转圈、token 逐字流式、运行结束自动收尾（loading 消失），无需切走切回。
   回归：交互式 Claude 对话仍正常流式；OpenClaw cron 立即运行仍正常（未改路径）。
   留意观察：handleTrigger 末尾 void loadSessions() 是否会把 currentSessionKey 从 run key 悄走（若发现流式中途消失，再查 loadSessions 的 currentSessionKey 重置逻辑 chat.ts:1646-1656）。