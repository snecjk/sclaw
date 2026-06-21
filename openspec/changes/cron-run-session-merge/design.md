## Context

定时任务（Cron Job）执行时，Gateway 会创建一个临时 run 会话，key 格式为 `agent:{agentId}:cron:{jobId}:run:{runSessionId}`。同时，后端也会生成按天聚合的虚拟会话，key 格式为 `agent:{agentId}:cron:{jobId}:{YYYY-MM-DD}`。

**当前问题**：执行期间，侧边栏同时显示临时 run 会话和按天聚合会话，造成视觉混乱。用户期望执行时只显示聚合会话，并在其上展示 loading 状态；执行完成后临时 run 会话消失，内容自动合并到聚合会话中。

## Goals / Non-Goals

**Goals:**
- 执行时：临时 run 会话不显示在侧边栏，其运行时状态（loading 圆点）映射到对应的按天聚合会话上
- 执行完成：临时 run 会话从侧边栏消失，聚合会话内容自动包含最新执行结果
- 零副作用：不影响普通 chat 会话、不影响 Gateway 事件流、不修改后端存储格式

**Non-Goals:**
- 不修改 Gateway 生成的 session key 格式
- 不修改后端 cron runs jsonl 存储格式
- 不修改 OpenClaw 核心执行逻辑
- 不引入新的持久化状态

## Decisions

### 1. 在 loadSessions 中过滤掉 run 会话，将其 runtime 状态映射到聚合会话

**Rationale**: loadSessions 是会话列表的唯一来源，在此处统一处理可以确保所有消费端（Sidebar、Chat 页面等）都看到一致的会话列表。run 会话的 `runtimeBySessionKey` 状态通过 key 映射规则转移到聚合会话上，Sidebar 无需额外逻辑即可显示 loading。

**Alternative considered**: 在 Sidebar 渲染层做过滤和映射。Rejected：渲染层无法安全地修改 `runtimeBySessionKey`，且多处消费会话列表（如 Chat 页面切换）需要重复处理。

### 2. 使用 jobId + 当天日期作为聚合会话 key，映射 run 会话的 runtime 状态

**Rationale**: 按天聚合会话的日期就是当天日期，run 会话发生时必然属于"今天"的聚合。因此映射规则是确定的：`agent:main:cron:{jobId}:run:{runId}` → `agent:main:cron:{jobId}:{today}`。

**Alternative considered**: 通过 run 日志反查日期。Rejected：增加了异步查询复杂度，且 run 执行时日志可能尚未写入。当天日期是足够准确的映射。

### 3. 在 handleChatEvent 中，对 run 会话事件做 key 转换后再写入 runtimeBySessionKey

**Rationale**: Gateway 事件携带的是 run 会话 key，如果直接写入 `runtimeBySessionKey[runKey]`，Sidebar 无法找到对应的聚合会话来显示 loading。在事件入口层做 key 转换，确保 runtime 状态始终挂在聚合会话 key 上。

**Alternative considered**: 在 Sidebar 中通过 jobId 匹配来查找 run 会话的 runtime。Rejected：增加了 Sidebar 的复杂度，且破坏了 `runtimeBySessionKey` 与 `sessions` 的一一对应关系。

## Risks / Trade-offs

- **[Risk]** 跨天执行时（如 23:59 开始，00:01 完成），run 会话映射到"今天"的聚合会话，但完成后日志可能写入"昨天"的日期。
  - **Mitigation**: 这是可接受的边缘情况。run 会话的实时 loading 只需要在执行期间显示，执行完成后 loading 消失。最终历史内容通过后端 API 重新加载，会正确按日志日期分组。

- **[Risk]** 同一天多次执行时，多个 run 会话同时映射到同一个聚合会话的 runtime 状态，可能产生状态覆盖。
  - **Mitigation**: 同一任务通常不会并发执行（cron 调度是串行的）。即使有重叠，`sending` 布尔值和 `activeRunId` 字符串的覆盖不会导致严重问题——loading 状态只是视觉反馈，最终历史通过 API 重新加载。

- **[Risk]** 如果当天还没有聚合会话（首次执行），过滤 run 会话后侧边栏可能完全不显示该任务。
  - **Mitigation**: 在 loadSessions 中，如果检测到 run 会话但不存在对应的当天聚合会话，自动创建一个虚拟的聚合会话条目（使用当前日期作为 label），确保侧边栏始终可见。
