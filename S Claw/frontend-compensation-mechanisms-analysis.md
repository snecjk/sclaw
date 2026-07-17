# StoClaw 前端会话消息补偿机制深度分析报告

> 分析范围：乐观更新、错误补偿、历史轮询、消息去重、消息队列自动发送、前后端状态同步
> 分析日期：2026-07-16
> 目标分支：feat_cy_session_manage

---

## 1. 核心文件映射说明

用户原始指定的文件路径基于旧版目录结构 `app/renderer/src/store/`，当前实际代码已迁移至 `src/stores/` 目录。以下是对应关系：

| 原始路径 | 实际路径 | 说明 |
|---|---|---|
| `app/renderer/src/store/runtime-send-actions.ts` | `src/stores/chat.ts` (L2474-L2902) + `src/stores/chat/runtime-send-actions.ts` (旧版副本) | `sendMessage` / `abortRun` 已内联至主 store |
| `app/renderer/src/store/message-queue.ts` | `src/stores/message-queue.ts` | 消息队列与自动发送逻辑 |
| `app/renderer/src/store/dispatch-chat-send.ts` | **不存在** | 该文件已合并至 `src/stores/chat.ts` 的 `sendMessage` 中 |
| `app/renderer/src/store/history.ts` | `src/stores/chat.ts` (L2020-L2469) + `src/stores/chat/history-actions.ts` (旧版副本) | `loadHistory` 已内联至主 store |

---

## 2. 乐观更新机制 (Optimistic Update)

### 2.1 触发点与时机

`sendMessage` 在 **RPC 调用之前** 立即执行乐观插入：

- 文件：`src/stores/chat.ts` L2670-L2717
- 行为：用户点击发送后，不等待后端响应，立即将用户消息插入 `messages` 数组

### 2.2 乐观消息的数据结构

```typescript
const userMsg: RawMessage = {
  role: 'user',
  content: displayText || (attachments?.length ? '(file attached)' : ''),
  timestamp: nowMs / 1000,          // 秒级时间戳
  id: crypto.randomUUID(),          // 前端生成的唯一 ID
  _skillMeta: skillMeta,            // Skill Plaza 标签元数据（本地-only）
  _attachedFiles: attachments?.map(...), // 附件预览元数据（本地-only）
};
```

### 2.3 状态同步

```typescript
set((s) => ({
  messages: dedupeRedundantUserMessages([...s.messages, userMsg], nowMs, { sessionKey: currentSessionKey }),
  sending: true,
  error: null,
  streamingText: '',
  streamingMessage: null,
  streamingMessages: [],
  streamingToolResults: [],
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: nowMs,
  optimisticUserMessage: userMsg,   // 缓存到 runtime 状态，用于跨 session 切换恢复
}));
```

关键状态：
- `sending = true`：锁定输入框，显示加载状态
- `lastUserMessageAt = nowMs`：标记最近一次用户发送时间戳，用于后续去重和超时判断
- `optimisticUserMessage = userMsg`：缓存乐观消息，当 `switchSession` 清空 `messages` 后，仍可在 `loadHistory` 时恢复该消息

---

## 3. 消息 ID 生成与幂等键 (IdempotencyKey)

### 3.1 前端生成策略

乐观消息的 `id` 由 `crypto.randomUUID()` 生成，保证全局唯一。该 ID 被同时用作 **幂等键** 传递给后端：

```typescript
// src/stores/chat.ts L2808-L2814
const idempotencyKey = userMsg.id;
```

### 3.2 后端回显配对机制

RPC 发送时，`idempotencyKey` 被写入 `chat.send` 或 `chat.send-with-media` 请求体：

```typescript
result = await hostApiFetch('/api/chat/send', {
  method: 'POST',
  body: JSON.stringify({
    sessionKey: currentSessionKey,
    message: gatewayMessage,
    deliver: false,
    idempotencyKey,   // <-- 传递
    ...
  }),
});
```

Gateway 收到后，将该 `idempotencyKey` 写入用户消息记录。当 `loadHistory` 拉取后端历史时，后端回显的消息会携带相同的 `id`。

### 3.3 前端配对逻辑：`isSameUserMessage`

文件：`src/stores/chat/user-message-merge.ts` L102-L144

配对优先级（从高到低）：

1. **ID 精确匹配**：`candidate.id === optimistic.id`（最可靠）
2. **时间窗口匹配**：`Math.abs(candidateMs - optimisticMs) < OPTIMISTIC_SEND_WINDOW_MS (5s)`
3. **显示文本匹配**：`displayTextMatches(candidate, optimistic)`（去除空白后比对）
4. **原始文本匹配**：`rawTextMatches`（含附件比对）
5. **Skill 消息宽窗口**：`SERVER_ECHO_WINDOW_MS (120s)` 内按时间匹配（Skill 消息后端处理可能较慢）

若配对成功，`loadHistory` 在 `mergeOptimisticUserIntoHistory` 中会丢弃乐观消息，保留后端回显消息（因为后端消息可能包含 Gateway 追加的元数据）。

---

## 4. 消息去重机制：`chatEventDedupe`

### 4.1 用途

防止 Gateway WebSocket 事件重复投递导致消息重复渲染、状态抖动。

### 4.2 实现

文件：`src/stores/chat.ts` L220-L315

```typescript
const CHAT_EVENT_DEDUPE_TTL_MS = 30_000;
const _chatEventDedupe = new Map<string, number>();
```

**去重键构建** (`buildChatEventDedupeKey`)：
- 包含 `runId`、`sessionKey`、`seq`（序列号）、`eventState`（delta/final/error 等）
- **对于 delta 事件**：额外计算 `message.content` 的文本/ thinking 总长度，追加到 key 中，避免将同一轮次的连续流式片段误判为重复

```typescript
// 示例 key 格式：
"run-abc|session:xyz|42|delta|128"
```

**清理策略**：
- 每次收到事件时调用 `pruneChatEventDedupe(now)`，删除超过 30 秒的旧条目
- 30 秒 TTL 足够覆盖绝大多数流式会话周期，同时避免 Map 无限增长

### 4.3 用户消息去重：`dedupeRedundantUserMessages`

文件：`src/stores/chat/user-message-merge.ts` L207-L342

这是一个更复杂的去重器，处理乐观消息与后端回显的合并结果。核心规则：

- **相同 ID**：直接删除后出现的副本
- **相邻用户消息**（`j === i + 1`）：按 `isSameUserMessage` 判断是否为同一轮的乐观+回显，保留先出现的（通常是回显），删除后出现的（乐观）
- **非相邻用户消息**：即使文本相同，也不删除（防止连续两轮发送相同文本时误删第二轮）
- **Synthetic session label**：从 `sessionLabels` 反推生成的占位 opener 消息，在与真实用户消息冲突时丢弃

---

## 5. 错误补偿机制

### 5.1 发送失败的即时标记

当 `hostApiFetch` 返回 `!result.success` 或抛出异常时：

```typescript
// src/stores/chat.ts L2875-L2901
set((s) => ({
  messages: s.messages.map((message, index, arr) => (
    index === arr.length - 1 && message.role === 'user'
      ? { ...message, isError: true }
      : message
  )),
  error: formatChatRuntimeError(result.error || 'Failed to send message'),
  sending: false,
  activeRunId: null,
  pendingFinal: false,
}));
```

- 将 **最后一条用户消息** 标记 `isError: true`
- 停止发送状态（`sending = false`）
- 显示错误横幅

### 5.2 90 秒安全超时（Stuck Detection）

文件：`src/stores/chat.ts` L2778-L2806

```typescript
const SAFETY_TIMEOUT_MS = 90_000;
const checkStuck = () => {
  const state = get();
  if (!state.sending) return;
  if (state.streamingMessage || state.streamingText) return;  // 仍在流式输出，不超时
  if (state.pendingFinal) {
    setTimeout(checkStuck, 10_000);
    return;
  }
  if (Date.now() - getLastChatEventAt() < SAFETY_TIMEOUT_MS) {
    setTimeout(checkStuck, 10_000);  // 每 10 秒检查一次
    return;
  }
  // 超时：强制结束
  clearHistoryPoll();
  set({
    error: 'No response received from the model...',
    sending: false,
    activeRunId: null,
    lastUserMessageAt: null,
    optimisticUserMessage: null,
  });
};
setTimeout(checkStuck, 30_000);  // 首次检查在 30 秒后启动
```

逻辑：
- 30 秒后启动首次检查
- 之后每 10 秒检查一次
- 若 90 秒内未收到任何 `chatEvent`（通过 `lastChatEventAt` 追踪），且没有流式内容，则判定为 stuck
- 强制清除 `sending`、弹出错误提示、恢复输入框

### 5.3 流式中途错误的优雅恢复

文件：`src/stores/chat.ts` L3366-L3423

当 Gateway 在流式过程中发送 `error` 事件（如 `terminated`）：

1. **保留当前流式快照**：将 `streamingMessage` 中的部分回复内容保存为 `assistant` 消息，避免用户内容丢失
2. **15 秒错误恢复宽限期** (`ERROR_RECOVERY_GRACE_MS`)：
   - Gateway 可能因临时 API 失败自动重试，前端不立即结束 `sending`
   - 宽限期内如果收到新的 `delta` 事件，取消错误定时器，恢复流式
3. 宽限期结束后若仍未恢复，才真正终止运行并调用 `loadHistory(true)` 拉取最终状态

---

## 6. 历史轮询机制 (History Polling)

### 6.1 为什么需要轮询

Gateway 的 `chat.send` RPC 在 Agentic 对话中可能 **阻塞直到整轮对话完成**（OpenClaw 模式）。在此期间，Gateway 可能不发送流式事件，但后端历史已在更新（如工具调用中间结果）。前端需要主动轮询 `chat.history` 来展示进度。

### 6.2 实现

文件：`src/stores/chat.ts` L2760-L2776

```typescript
const POLL_START_DELAY = 3_000;   // 发送后 3 秒开始首次轮询
const POLL_INTERVAL = 4_000;      // 每 4 秒轮询一次

const pollHistory = () => {
  const state = get();
  if (!state.sending) { clearHistoryPoll(); return; }
  if (state.streamingMessage) {
    // 如果正在流式输出，跳过本次轮询（避免与流式事件竞争）
    _historyPollTimer = setTimeout(pollHistory, POLL_INTERVAL);
    return;
  }
  state.loadHistory(true);          // quiet=true，不显示 loading 转圈
  _historyPollTimer = setTimeout(pollHistory, POLL_INTERVAL);
};
_historyPollTimer = setTimeout(pollHistory, POLL_START_DELAY);
```

### 6.3 轮询的终止条件

- `sending` 变为 `false`（运行结束）
- 收到流式 `delta`/`final`/`error`/`aborted` 事件（`clearHistoryPoll()` 被调用）
- `loadHistory` 内部发现 `currentSessionKey` 已切换（安全退出）

### 6.4 轮询安全机制

`loadHistory` 内部实现了 **请求去重**（`_historyLoadInFlight`）和 **最小间隔限制**（`HISTORY_LOAD_MIN_INTERVAL_MS = 800ms`）：

```typescript
const existingLoad = _historyLoadInFlight.get(targetSessionKey);
if (existingLoad) { await existingLoad; return; }  // 等待正在进行的请求

const lastLoadAt = _lastHistoryLoadAtBySession.get(targetSessionKey) || 0;
if (quiet && !force && Date.now() - lastLoadAt < 800) return;
```

---

## 7. 消息队列自动发送 (Auto-Send)

### 7.1 架构设计

文件：`src/stores/message-queue.ts`

- 每个 session 拥有独立的队列（`Map<string, SessionQueue>`）
- 最大队列长度：`QUEUE_MAX_PER_SESSION = 10`
- 所有 UI 组件（Chat 页、Home、任务子项）共享 **同一个** `createAutoSendWatcher` 订阅实例（ref-counted）

### 7.2 队列操作 API

| 操作 | 说明 |
|---|---|
| `enqueue` | 用户发送时若 `sending === true`，消息入队 |
| `dequeueFirst` | 取出队首消息并移除 |
| `takeById` | 按 ID 取出（用于队列中直接点击发送） |
| `remove` | 删除指定消息 |
| `moveUp` / `moveDown` | 调整队列顺序 |
| `clear` | 清空某 session 队列 |

### 7.3 自动出队触发器

文件：`src/stores/message-queue.ts` L175-L404

```typescript
export function createAutoSendWatcher(onAutoSend?: AutoSendCallback): () => void {
  // 共享底层订阅，ref-counted
  if (!storeUnsub) {
    storeUnsub = useChatStore.subscribe((state) => {
      for (const sessionKey of collectWatchedSessionKeys(state)) {
        const sending = isSessionSending(sessionKey, state);
        const wasSending = prevSendingByKey.get(sessionKey) ?? false;
        prevSendingByKey.set(sessionKey, sending);
        if (!wasSending || sending) continue;          // 只关注 true -> false 的转换
        if (suppressedSessions.delete(sessionKey)) continue;  // 用户主动 abort，不触发
        if (sessionRunError(sessionKey, state)) continue;       // 运行出错，不触发（避免级联失败）
        tryDrainSessionQueue(sessionKey);              // 出队并发送一条
      }
    });
  }
}
```

**触发规则**：
1. 仅当 `sending` 从 `true` 变为 `false` 时触发（一轮运行结束）
2. 若结束是由用户点击 **Stop**（abort）导致的，则跳过（通过 `suspendAutoSend` 设置 `suppressedSessions`）
3. 若运行以 **错误** 结束，则跳过（避免连续失败消息自动发送）
4. 每次只出队 **一条** 消息，保证串行执行

### 7.4 消息投递

```typescript
function deliverQueuedMessage(sessionKey: string, msg: QueuedMessage): void {
  const chatState = useChatStore.getState();
  if (msg.workflowId) {
    // 工作流消息：先创建工作流，再在其上下文中发送
    sendWithWorkflow(...).catch(() => {
      // 回退为普通发送，避免消息丢失
      void chatState.sendMessage({ text: msg.text, ... });
    });
    return;
  }
  void chatState.sendMessage({ ...msg });  // 普通消息
}
```

---

## 8. 前端状态与后端同步：补偿机制全景

### 8.1 `loadHistory` 的补偿流水线

`loadHistory` 不是简单的替换 `messages`，而是执行 **多阶段合并与补偿**（`src/stores/chat.ts` L2046-L2378）：

1. **加载后端原始历史**：通过 `chat.history` RPC 或 fallback 路径（cron/scheduled task）
2. **防缩容合并**：`mergeHistoryWhenShrunk` — 若后端返回的消息数少于当前内存中的，保留内存中独有的旧消息（防止任务会话在 follow-up 发送时丢失历史）
3. **工具结果图片上浮**：`enrichWithToolResultFiles` — 将 `tool_result` 消息中的图片提取并附加到紧随其后的 `assistant` 消息（因为后端历史中 `tool_result` 通常被过滤，但图片需要展示给用户）
4. **图片缓存恢复**：`enrichWithCachedImages` — 从 `_imageCache`（localStorage）恢复 `[media attached: ...]` 的预览图
5. **乐观消息合并**：`mergeOptimisticUserIntoHistory` — 将当前内存中的乐观消息（或 `cachedOptimistic`）插入后端历史，如果后端历史尚未包含该消息
6. **去重**：`dedupeRedundantUserMessages` — 删除同一轮的乐观/回显重复消息
7. **Skill 元数据恢复**：`restoreSkillMetaOnMessages` — 后端不保存 `_skillMeta`，从内存缓存恢复
8. **会话标签恢复**：`recoverInitialUserFromSessionLabel` / `ensureOpeningUserMessageFirst` — 若后端历史缺少 opener（如新会话首次加载），用 `sessionLabels` 反向生成占位用户消息
9. **Workflow 表单恢复**：`mergeParameterFormBlocksFromCurrent` / `recoverParameterFormsOnHistoryLoad` — 保留工作流参数表单状态
10. **Workflow 本地回合恢复**：`mergeLocalWorkflowTurnsFromCurrent` / `mergeWorkflowCardBlocksFromCurrent` — 保留工作流卡片
11. **图片预览异步加载**：`loadMissingPreviews` — 通过 IPC 从磁盘加载缺失的预览图，完成后触发局部更新
12. **Claude 运行完成检测**：`shouldAutoCompleteClaudeFromHistory` — 若后端历史显示 `isRunning=false` 且有结果，但前端未收到 `final` 事件，主动结束 `sending`

### 8.2 跨 Session 状态保持：`runtimeBySessionKey`

当用户切换 session 时，`buildSessionSwitchPatch` 将当前 session 的完整运行时状态（`sending`、`activeRunId`、`streamingMessage`、`optimisticUserMessage` 等）快照保存到 `runtimeBySessionKey[oldKey]`。切换回来后，从快照恢复，避免：
- 后台运行的会话丢失 loading 状态
- 乐观消息在切换 session 后被清空

### 8.3 图片附件的本地补偿

后端 Gateway **不保存** 图片附件的预览数据（只保存文本形式的 `[media attached: path (mime) | ...]`）。前端通过以下机制补偿：

1. **发送前缓存**：`sendMessage` 在 RPC 前将附件信息写入 `_imageCache`（以 `stagedPath` 为 key）
2. **历史加载时恢复**：`enrichWithCachedImages` 扫描消息文本中的 `[media attached: ...]` 模式，从 `_imageCache` 重建 `_attachedFiles`
3. **localStorage 持久化**：`_imageCache` 以 `stoclaw:image-cache` 为 key 写入 localStorage，最多保留 100 条

---

## 9. 关键常量与阈值汇总

| 常量 | 值 | 用途 |
|---|---|---|
| `OPTIMISTIC_SEND_WINDOW_MS` | 5,000ms | 乐观消息与后端回显的时间匹配窗口 |
| `SERVER_ECHO_WINDOW_MS` | 120,000ms | Skill 消息宽窗口匹配 |
| `CHAT_EVENT_DEDUPE_TTL_MS` | 30,000ms | WebSocket 事件去重 TTL |
| `POLL_START_DELAY` | 3,000ms | 历史轮询首次延迟 |
| `POLL_INTERVAL` | 4,000ms | 历史轮询间隔 |
| `SAFETY_TIMEOUT_MS` | 90,000ms | 发送安全超时 |
| `ERROR_RECOVERY_GRACE_MS` | 15,000ms | 流式错误恢复宽限期 |
| `HISTORY_LOAD_MIN_INTERVAL_MS` | 800ms | 历史加载最小间隔（防重复请求） |
| `SESSION_LOAD_MIN_INTERVAL_MS` | 1,200ms | 会话列表加载最小间隔 |
| `STREAMING_MESSAGE_BUFFER_LIMIT` | 80 | 流式消息快照最大保留数 |
| `QUEUE_MAX_PER_SESSION` | 10 | 单会话消息队列上限 |
| `IMAGE_CACHE_MAX` | 100 | 本地图片缓存上限 |

---

## 10. 风险点与边界情况

1. **90 秒超时与长轮询**：对于超长 Agentic 对话（如多轮工具调用），90 秒 `SAFETY_TIMEOUT` 可能过于激进，但轮询机制 (`loadHistory`) 会刷新 `lastChatEventAt`，因此实际超时是从 **最后一次有意义事件**（流式或轮询）开始计算，通常不会误触发。

2. **ID 匹配失败回退**：如果后端未正确回显 `idempotencyKey`，`isSameUserMessage` 会降级为文本+时间匹配。在文本完全相同、时间戳缺失的情况下，存在误判风险（但 5 秒窗口和附件比对大幅降低了概率）。

3. **消息队列级联失败**：`sessionRunError` 检查会阻止错误后自动出队，但用户手动点击队列中的消息发送时 (`sendImmediately`) 会 **强制 abort 当前运行** 并发送，可能导致运行中断。

4. **多客户端竞争**：`idempotencyKey` 机制解决了单客户端重复发送，但多客户端同时发送时，后端可能出现两个不同的用户消息（不同 id），前端当前不会合并它们。

5. **Gateway 阻塞期间的前端状态**：`chat.send` 在 OpenClaw 模式下可能阻塞数分钟。前端完全依赖轮询和超时来感知进度，若轮询也失败，用户只能看到静态的 `sending` 状态。

---

## 11. 总结

StoClaw 的前端消息补偿机制是一个**多层防御体系**：

- **乐观层**：用户输入立即响应，零延迟感知
- **幂等层**：`idempotencyKey` + `isSameUserMessage` 确保前后端消息一一对应
- **去重层**：30 秒事件去重 + 相邻消息去重，防止重复渲染
- **轮询层**：4 秒周期轮询填补 Gateway 无事件推送的空白期
- **超时层**：90 秒安全网 + 15 秒错误恢复，防止 UI 永远卡住
- **队列层**：运行完成后自动 drain，保证多消息顺序执行
- **缓存层**：本地图片缓存 + 运行时状态快照，跨 session 不丢失数据

该设计在保证用户体验流畅性的同时，对后端不可靠性（延迟、阻塞、事件丢失、重复投递）具有高度韧性。
