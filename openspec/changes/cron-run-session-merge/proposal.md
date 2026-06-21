## Why

定时任务（Cron Job）执行时，Gateway 会创建一个临时 run 会话，key 格式为 `agent:{agentId}:cron:{jobId}:run:{runSessionId}`。同时，后端也会生成按天聚合的虚拟会话，key 格式为 `agent:{agentId}:cron:{jobId}:{YYYY-MM-DD}`。

**当前问题**：执行期间，侧边栏同时显示临时 run 会话和按天聚合会话，造成视觉混乱。用户期望执行时只显示聚合会话，并在其上展示 loading 状态；执行完成后临时 run 会话消失，内容自动合并到聚合会话中。

## What Changes

- **修改 `src/stores/chat/cron-session-utils.ts`**：新增 `getCronRunSessionAggregateKey()` 函数，将 cron run 会话 key 映射到当天的聚合会话 key。
- **修改 `src/stores/chat/session-actions.ts` 和 `src/stores/chat.ts`**：在 `loadSessions` 中过滤掉临时 run 会话（当对应 job 已有按天聚合会话时），避免侧边栏同时显示两者。
- **修改 `src/stores/chat.ts` `handleChatEvent`**：将 cron run 会话的事件映射到聚合会话 key 上写入 `runtimeBySessionKey`，使 loading 状态显示在聚合会话上。
- **修改 `src/stores/gateway.ts` `handleGatewayNotification`**：在 `started` 和 `completed` 事件处理中，将 run 会话 key 转换为聚合会话 key 后再触发状态更新和会话刷新。
- **修改 `src/components/layout/Sidebar.tsx`**：在 `SidebarScheduledTaskGroup` 中为聚合会话添加 loading 圆点指示器（当 `runtimeBySessionKey[sessionKey].sending` 为 true 时）。

## Capabilities

### New Capabilities
- 无新增 Capability。本次为现有 `cron-session-management` 的优化增强。

### Modified Capabilities
- `cron-session-management`：定时任务会话的加载、过滤、运行时状态映射和侧边栏展示逻辑。

## Impact

- **Renderer 进程**：修改 chat store、gateway store、Sidebar 组件。
- **无后端/主进程变更**：不修改 Gateway 生成的 session key 格式，不修改后端 cron runs jsonl 存储格式。
- **无新持久化状态**：纯前端运行时状态映射，零副作用。
