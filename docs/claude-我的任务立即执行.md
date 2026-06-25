# Claude 类型我的任务「立即执行」后 Chat 界面空白问题

## 问题现象

- **OpenClaw 任务**：点击卡片「立即执行」→ 正常跳转到 Chat 聊天框，发送消息并显示内容
- **Claude 任务**：点击卡片「立即执行」→ 打开 Chat 聊天界面，但界面显示空白，什么也没有

## 根本原因

Claude 任务跳转到 Chat 后界面空白，有 **三个连锁 bug**，核心问题与引擎类型（engineType）参数传递有关——Claude 任务的 sessionKey 无法被正确识别和路由。

### Bug 1：`loadSessions` 没有加载 Claude 任务会话

**文件**：`src/stores/chat.ts` 第 1545 行附近

`loadSessions` 只加载了 OpenClaw 定时任务和 cron 会话：

```ts
const [stRes, cronRes] = await Promise.all([
  hostApiFetch('/api/scheduled-tasks/sessions').catch(() => null),
  hostApiFetch('/api/cron/sessions').catch(() => null),
]);
rawSessions = [...rawSessions, ...stSessions, ...cronSessions];
```

**缺少** `/api/claude-scheduled-tasks/sessions` 的加载。后端 API 已存在（`electron/api/routes/claude-scheduled-tasks.ts:66`），但前端从未调用。导致 Claude 任务的会话永远不会出现在 `sessions` 数组中，`engineType: 'claude'` 无法通过会话查找获取。

### Bug 2：`ensureSessionEntry` 无法识别 Claude 会话键

**文件**：`src/stores/chat.ts` 第 838 行

当 `switchSession` 发现目标会话不存在时，`ensureSessionEntry` 会创建一条新记录：

```ts
function ensureSessionEntry(sessions, sessionKey) {
  // ...
  return [...sessions, {
    key: sessionKey,
    engineType: getAgentEngineType(getAgentIdFromSessionKey(sessionKey)), // ← 问题！
  }];
}
```

- Claude 的会话键格式是 `claude-task:xxx` 或 `claude-task-run:xxx:yyy`
- `getAgentIdFromSessionKey` 对不以 `agent:` 开头的键直接返回 `'main'`
- `'main'` 代理通常是 openclaw 引擎 → **`engineType` 被错误设为 `'openclaw'`**

### Bug 3：`loadHistory` 没有 Claude 任务的历史回退

**文件**：`src/stores/chat.ts` 第 2239 行及 2253 行附近

正常路径和 catch 块中，都只有 cron 的回退加载：

```ts
// 正常路径
if (rawMessages.length === 0 && (isCronSessionKey(targetSessionKey) || isCronDatedSessionKey(targetSessionKey))) {
  rawMessages = await loadCronFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
}

// catch 块
const fallbackMessages = await loadCronFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
```

**完全没有** Claude 任务的历史回退。后端 `/api/claude-scheduled-tasks/session-history` API 已存在（`electron/api/routes/claude-scheduled-tasks.ts:76`），但前端从未调用。现有的 `cron-session-utils.ts` 中已有 `isClaudeScheduledTaskSessionKey`、`isClaudeScheduledTaskRunSessionKey`、`buildClaudeScheduledTaskSessionHistoryPath` 等工具函数，但 `chat.ts` 没有导入和使用它们。

### 完整失败链条

```
用户点击 Claude 任务「立即执行」
  → triggerJob(task.id, 'claude') → 返回 ClaudeScheduledTaskRunRecord（含 sessionKey）
  → switchSession('claude-task-run:taskId:runId')
    → getAgentIdFromSessionKey('claude-task-run:...') → 'main'（因为不以 agent: 开头）
    → ensureSessionEntry → engineType = getAgentEngineType('main') → 'openclaw'（错误！）
    → loadHistory()
      → resolveEngineTypeForSession(sessions, key, 'main')
        → sessions 中找不到该 Claude 会话（Bug 1）
        → 或找到但 engineType 为 'openclaw'（Bug 2）
      → Gateway RPC chat.history(engineType='openclaw') → 返回空消息
      → 正常路径回退: isCronSessionKey → false, isCronDatedSessionKey → false → 不匹配
      → catch 块: loadCronFallbackMessages → 不是 cron 键 → 返回空数组（Bug 3）
    → set({ messages: [], loading: false }) → 界面空白！
```

---

## 修复计划

### 步骤 1：导入缺失的 Claude 会话键工具函数

**文件**：`src/stores/chat.ts` 第 15 行（导入区域）

当前导入：
```ts
import { buildCronSessionHistoryPath, getCronRunSessionAggregateKey, isCronSessionKey, isCronDatedSessionKey, parseCronSessionKey, parseScheduledTaskAgentSessionKey } from './chat/cron-session-utils';
```

增加导入：
```ts
import {
  buildCronSessionHistoryPath, getCronRunSessionAggregateKey,
  isCronSessionKey, isCronDatedSessionKey,
  parseCronSessionKey, parseScheduledTaskAgentSessionKey,
  // ↓ 新增 Claude 任务相关
  isClaudeScheduledTaskSessionKey, isClaudeScheduledTaskRunSessionKey,
  buildClaudeScheduledTaskSessionHistoryPath,
} from './chat/cron-session-utils';
```

### 步骤 2：增加 `loadClaudeScheduledTaskFallbackMessages` 函数

**文件**：`src/stores/chat.ts` 第 806 行附近（紧跟 `loadCronFallbackMessages` 函数之后）

仿照 `loadCronFallbackMessages` 的模式，新增：

```ts
async function loadClaudeScheduledTaskFallbackMessages(sessionKey: string, limit = CHAT_HISTORY_LIMIT): Promise<RawMessage[]> {
  if (!isClaudeScheduledTaskSessionKey(sessionKey) && !isClaudeScheduledTaskRunSessionKey(sessionKey)) return [];
  try {
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      buildClaudeScheduledTaskSessionHistoryPath(sessionKey, limit),
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('Failed to load claude scheduled task fallback history:', error);
    return [];
  }
}
```

### 步骤 3：修复 `ensureSessionEntry` — 识别 Claude 会话键

**文件**：`src/stores/chat.ts` 第 838 行

当前：
```ts
function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  return [...sessions, {
    key: sessionKey,
    engineType: getAgentEngineType(getAgentIdFromSessionKey(sessionKey)),
  }];
}
```

修改为：
```ts
function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  const engineType: ChatSession['engineType'] =
    isClaudeScheduledTaskSessionKey(sessionKey) || isClaudeScheduledTaskRunSessionKey(sessionKey)
      ? 'claude'
      : getAgentEngineType(getAgentIdFromSessionKey(sessionKey)) ?? 'openclaw';
  return [...sessions, { key: sessionKey, engineType }];
}
```

### 步骤 4：修复 `loadSessions` — 增加 Claude 任务会话加载

**文件**：`src/stores/chat.ts` 第 1543-1556 行

当前：
```ts
const [stRes, cronRes] = await Promise.all([
  hostApiFetch('/api/scheduled-tasks/sessions').catch(() => null),
  hostApiFetch('/api/cron/sessions').catch(() => null),
]);
const stData = stRes && typeof stRes === 'object' ? (stRes as Record<string, unknown>) : null;
const cronData = cronRes && typeof cronRes === 'object' ? (cronRes as Record<string, unknown>) : null;
const stSessions = Array.isArray(stData?.sessions) ? (stData.sessions as Record<string, unknown>[]) : [];
const cronSessions = Array.isArray(cronData?.sessions) ? (cronData.sessions as Record<string, unknown>[]) : [];
rawSessions = [...rawSessions, ...stSessions, ...cronSessions];
```

修改为：
```ts
const [stRes, cronRes, claudeTaskRes] = await Promise.all([
  hostApiFetch('/api/scheduled-tasks/sessions').catch(() => null),
  hostApiFetch('/api/cron/sessions').catch(() => null),
  hostApiFetch('/api/claude-scheduled-tasks/sessions').catch(() => null),
]);
const stData = stRes && typeof stRes === 'object' ? (stRes as Record<string, unknown>) : null;
const cronData = cronRes && typeof cronRes === 'object' ? (cronRes as Record<string, unknown>) : null;
const claudeTaskData = claudeTaskRes && typeof claudeTaskRes === 'object' ? (claudeTaskRes as Record<string, unknown>) : null;
const stSessions = Array.isArray(stData?.sessions) ? (stData.sessions as Record<string, unknown>[]) : [];
const cronSessions = Array.isArray(cronData?.sessions) ? (cronData.sessions as Record<string, unknown>[]) : [];
const claudeTaskSessions = Array.isArray(claudeTaskData?.sessions) ? (claudeTaskData.sessions as Record<string, unknown>[]) : [];
rawSessions = [...rawSessions, ...stSessions, ...cronSessions, ...claudeTaskSessions];
```

注意：下方的 session mapping 逻辑（第 1559-1574 行）已经有 `engineType` 字段的正确判断：
```ts
const engineType: ChatSession['engineType'] = s.engineType === 'claude' ? 'claude' : 'openclaw';
```
所以只要后端返回的 Claude 会话带有 `engineType: 'claude'`，就会被正确映射，无需额外改动。

### 步骤 5：修复 `loadHistory` 正常路径 — 增加 Claude 任务回退

**文件**：`src/stores/chat.ts` 第 2239 行附近

当前：
```ts
if (rawMessages.length === 0 && (isCronSessionKey(targetSessionKey) || isCronDatedSessionKey(targetSessionKey))) {
  rawMessages = await loadCronFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
}
```

修改为：
```ts
if (rawMessages.length === 0 && (isCronSessionKey(targetSessionKey) || isCronDatedSessionKey(targetSessionKey))) {
  rawMessages = await loadCronFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
} else if (rawMessages.length === 0 && (isClaudeScheduledTaskSessionKey(targetSessionKey) || isClaudeScheduledTaskRunSessionKey(targetSessionKey))) {
  rawMessages = await loadClaudeScheduledTaskFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
}
```

### 步骤 6：修复 `loadHistory` catch 块 — 增加 Claude 任务回退

**文件**：`src/stores/chat.ts` 第 2253-2267 行

当前：
```ts
} catch (err) {
  console.warn('Failed to load chat history:', err);
  if (get().currentSessionKey !== targetSessionKey) return;
  const fallbackMessages = await loadCronFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
  if (get().currentSessionKey !== targetSessionKey) return;
  if (fallbackMessages.length > 0) {
    // ... 渲染 cron 回退消息
  } else if (get().currentSessionKey === targetSessionKey) {
    set({ messages: [], loading: false });
  }
}
```

修改为：
```ts
} catch (err) {
  console.warn('Failed to load chat history:', err);
  if (get().currentSessionKey !== targetSessionKey) return;
  let fallbackMessages: RawMessage[] = [];
  if (isCronSessionKey(targetSessionKey) || isCronDatedSessionKey(targetSessionKey)) {
    fallbackMessages = await loadCronFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
  } else if (isClaudeScheduledTaskSessionKey(targetSessionKey) || isClaudeScheduledTaskRunSessionKey(targetSessionKey)) {
    fallbackMessages = await loadClaudeScheduledTaskFallbackMessages(targetSessionKey, CHAT_HISTORY_LIMIT);
  }
  if (get().currentSessionKey !== targetSessionKey) return;
  if (fallbackMessages.length > 0) {
    await absorbWorkflowExecutionStartedFromToolResults(fallbackMessages, {
      sessionKey: targetSessionKey,
      agentId: get().currentAgentId,
    });
    if (get().currentSessionKey !== targetSessionKey) return;
    applyLoadedMessages(fallbackMessages, null);
  } else if (get().currentSessionKey === targetSessionKey) {
    set({ messages: [], loading: false });
  }
}
```

---

## 涉及的关键文件

| 文件 | 修改内容 |
|------|---------|
| `src/stores/chat.ts` | 主要修改文件 — 6 个步骤全部在此文件 |
| `src/stores/chat/cron-session-utils.ts` | 已有工具函数，无需修改，只增加导入 |

**后端无需修改**：`electron/api/routes/claude-scheduled-tasks.ts` 中 `/api/claude-scheduled-tasks/sessions` 和 `/api/claude-scheduled-tasks/session-history` 两个端点已经存在。

## 验证方法

1. 创建一个 Claude 类型的定时任务
2. 在 MyTask 卡片上点击「立即执行」
3. 确认跳转到 Chat 后界面能正常显示消息内容（不再空白）
4. 检查侧边栏中该 Claude 任务会话是否正确显示，且 `engineType` 为 `'claude'`
5. 离开 Chat 再返回，确认历史消息能正常加载
6. 同样测试 OpenClaw 类型任务，确认原有功能不受影响
