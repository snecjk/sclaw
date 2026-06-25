# Claude 定时任务按天聚合对话

## Context

MyTask 页面的"立即运行"功能，openClaw 引擎会按天聚合对话（同一天多次触发共享一个 `agent:{agentId}:cron:{jobId}:{YYYY-MM-DD}` 会话），而 Claude 引擎每次触发都生成独立的 `claude-task-run:{taskId}:{runId}` 会话，导致侧边栏出现多条独立记录。

用户希望 Claude 引擎也参照 openClaw 的模式，实现按天聚合。

## 当前行为对比

| | openClaw | Claude |
|---|---|---|
| sessionKey 格式 | `agent:{agentId}:cron:{jobId}:{YYYY-MM-DD}` | `claude-task-run:{taskId}:{runId}` |
| 同一天多次触发 | 跳转到同一个按天聚合会话 | 每次跳转到独立的 run 会话 |
| 侧边栏 | 1 条/天 | N 条/次 |

## 实施方案

### 新增按天聚合 session key 格式

参照 openClaw 的 `agent:{agentId}:cron:{jobId}:{YYYY-MM-DD}`，为 Claude 引擎新增：

**`claude-task:{taskId}:{YYYY-MM-DD}`**

例如：`claude-task:abc-123:2026-06-25`

### 修改点

#### 1. `src/stores/chat/cron-session-utils.ts` — 新增解析和聚合函数

- 扩展 `parseClaudeScheduledTaskSessionKey` 支持带日期的格式 `claude-task:{taskId}:{YYYY-MM-DD}`
- 新增 `getClaudeTaskRunSessionAggregateKey()` 函数，将 `claude-task-run:{taskId}:{runId}` → `claude-task:{taskId}:{YYYY-MM-DD}`（参照 `getCronRunSessionAggregateKey`）
- 新增 `isClaudeScheduledTaskDatedSessionKey()` 判断函数
- 新增 `buildClaudeTaskDatedSessionKey(taskId, date)` 构建函数

#### 2. `src/pages/MyTask/index.tsx` — `handleTrigger` 逻辑修改

当前 Claude 分支直接使用 `result.sessionKey`（即 `claude-task-run:{taskId}:{runId}`），改为构建按天聚合 key：

```typescript
if (task.engineType === 'claude') {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const sessionKey = `claude-task:${task.id}:${y}-${m}-${d}`;
  navigateToMainChatHome(navigate, location.pathname, () => {
    useChatStore.getState().switchSession(sessionKey);
  });
  void useChatStore.getState().loadSessions();
}
```

#### 3. `src/stores/chat.ts` — `loadSessions` 新增 Claude 按天聚合去重

参照现有 cron 去重逻辑（lines 1609-1668），新增 Claude 任务去重：

- 扫描所有 session，识别 `claude-task:{taskId}:{date}` 格式 → 构建 `claudeTaskDated` set
- 过滤掉 `claude-task:{taskId}`（base）当存在 dated 替代
- 过滤掉 `claude-task-run:{taskId}:{runId}` 当该 task 有 dated 聚合 session
- 新增 `seenClaudeTaskDated` 防止同一 taskId+date 出现多次

#### 4. `src/stores/chat.ts` — `handleChatEvent` 新增 Claude run key 映射

参照 `getCronRunSessionAggregateKey` 的用法（lines 2679-2719），在事件处理中：

- 当 `eventSessionKey` 是 `claude-task-run:{taskId}:{runId}` 格式时，调用 `getClaudeTaskRunSessionAggregateKey` 映射为按天聚合 key
- 这样加载指示器和实时事件都指向聚合会话

#### 5. `src/components/layout/Sidebar.tsx` — 侧边栏聚合显示

- `taskListScheduledSessions` 过滤条件中新增识别 `claude-task:{taskId}:{date}` 格式
- 分组逻辑中，Claude dated session 应与 Claude run session 同组（groupKey `claude-task:{taskId}`）

#### 6. `electron/services/claude-scheduled-task-session-store.ts` — 后端支持

- 新增 `buildClaudeTaskDatedSessionKey(taskId, date)` 函数
- 新增按天聚合 session 的创建/读取/写入逻辑（`ensureDatedSession` 等），参照 `ensureSummarySession`
- `readClaudeScheduledTaskSessionHistory` 支持 `claude-task:{taskId}:{date}` 格式读取
- `listClaudeScheduledTaskSummarySessions` 输出中包含 dated aggregate sessions
- `appendClaudeScheduledTaskSummaryRun` 也要往 dated aggregate session 写入（同一天的 run 都追加到同一 dated session）

#### 7. `src/stores/chat.ts` — `loadHistory` 支持 Claude dated key

确保 `switchSession` → `loadHistory` 对 `claude-task:{taskId}:{date}` 格式能正确请求历史。当前 `buildClaudeScheduledTaskSessionHistoryPath` 只支持 `claude-task:{taskId}` 和 `claude-task-run:{taskId}:{runId}`，需扩展。

## 关键文件列表

| 文件 | 修改类型 |
|---|---|
| `src/stores/chat/cron-session-utils.ts` | 新增解析/构建/聚合函数 |
| `src/pages/MyTask/index.tsx` | handleTrigger 改为构建按天 key |
| `src/stores/chat.ts` | loadSessions 去重 + handleChatEvent 映射 + loadHistory 支持 |
| `src/components/layout/Sidebar.tsx` | 侧边栏分组支持 |
| `electron/services/claude-scheduled-task-session-store.ts` | dated session CRUD |
| `electron/api/routes/claude-scheduled-tasks.ts` | sessions 列表返回 dated sessions |

## 验证方式

1. 创建一个 Claude 定时任务
2. 在同一天点击"立即运行"两次
3. 确认侧边栏只出现 1 条按天聚合记录（如 `claude-task:{taskId}:2026-06-25`）
4. 确认两次运行的对话内容都聚合在同一会话中
5. 确认跨天触发会生成不同日期的聚合会话
6. 确认已有 `claude-task:{taskId}`（base）session 被 dated 替代隐藏
