# 重复输入覆盖上次输出 —— 根因与 id 回环方案

> 适用范围：StoClaw 聊天会话窗口
> 关联代码：`src/stores/chat.ts`、`src/stores/chat/user-message-merge.ts`、`src/pages/Chat/`
> 日期：2026-06-25

---

## 1. 现象

在聊天会话窗口中，**当本次用户输入与上一次完全相同时**，本次的输出会在上次输出记录的位置上重新渲染，把上次的输出覆盖掉（旧输出消失，只剩新输出）。

---

## 2. 根因（已验证，非 React key 冲突）

### 2.1 结论一句话

根因在数据层的「用户消息去重」逻辑：`isSameUserMessage()` 在判断两条 user 消息是否「同一条」时，除 id 匹配外，还用**文本内容相同**作为兜底判据。由于每次发送的 user 消息都新生成 `crypto.randomUUID()` 作为 id、且该 id 从不回环（见第 3 节），id 分支永不命中，于是两条**内容相同但分属两次独立发送**的 user 消息被误判为重复，后一条被丢弃。丢掉后两次 assistant 回复相邻，被合并成一个 turn，渲染时只显示最后一条 —— 看起来就是新输出「覆盖」了旧输出。

### 2.2 关键代码：`src/stores/chat/user-message-merge.ts`

`isSameUserMessage`（L24-54）：

```ts
if (candidate.id && optimistic.id && candidate.id === optimistic.id) return true;  // L30：两次发送 id 不同，永不命中

const textMatches = candidateText === optimisticText && attachmentsMatch(...);     // L34-36：纯文本比较

if (hasCandidateTime && Number.isFinite(referenceMs)) {
  if (Math.abs(candidateMs - referenceMs) < 5000) return true;
  if (textMatches && userMessageAt > 0) return true;   // ← L47 BUG：发送期间只要文本相同就判为同一条
  if (Math.abs(candidateMs - referenceMs) > 60_000) return false;
}

return textMatches;   // ← L53 BUG：60s 内纯文本相同即判同一条
```

`dedupeRedundantUserMessages`（L74-110）在判定为「同一条」后丢弃**后面那条**：

```ts
if (!isSameUserMessage(second, first, refAt) && !isSameUserMessage(first, second, refAt)) { ... continue; }
drop.add(j);     // L104：丢弃后面的（新的）user 消息
```

### 2.3 完整触发链（以连发两次 "hello" 为例）

1. 发送1 "hello" → `messages = [user1, assistant1]`，`lastUserMessageAt` 之后被清。
2. 发送2 "hello" → `sendMessage` 创建 `user2`（新 uuid，ts=T2），追加进数组，置 `lastUserMessageAt=T2`、`activeRunId=runId2`。
3. 流式分片按 `runId` 正确写入 `streamingMessage` 槽（这层没问题）。
4. `final` 到达时执行 `dedupeRedundantUserMessages([...messages, assistant2], T2)`（`runtime-event-handlers.ts:171` / chat.ts 内联路径）。比较 `user2` 与 `user1`：id 不同，但 **L47** `textMatches && userMessageAt(T2) > 0` 命中 → `user2` 被丢弃（L104）。结果 `[user1, assistant1, assistant2]`，**两条 assistant 之间没有 user 消息**。
5. 随后 `loadHistory`（`runtime-event-handlers.ts:198` / chat.ts:2093）又跑一次 `dedupeRedundantUserMessages`（`history-actions.ts:112` / chat.ts:2160），若 T2−T1 < 60s，**L53** `return textMatches` 再次命中，`user2` 仍被丢弃。
6. 渲染 `buildChatDisplayItems`（`src/pages/Chat/chat-display.ts:162`）：assistant-turn 分组循环只在遇到 `user` 角色时 `break`（L203）。`user2` 已没了，`assistant1`+`assistant2` 被合并成单个 turn（L231-238）。
7. `pickAssistantReplyMessage`（`chat-display.ts:257-262`）返回**最后一条有文本**的消息 = `assistant2`，`assistant1` 的回复文本不单独渲染。
8. 最终 UI：`[user: hello] [assistant: resp2]`，旧输出 `resp1` 消失 —— 即报告的「覆盖」现象。

### 2.4 关键文件 / 行号速查

| 环节 | 文件 | 行 |
|---|---|---|
| **根因：文本兜底判同条** | `src/stores/chat/user-message-merge.ts` | 47、53 |
| **丢弃后一条 user** | `src/stores/chat/user-message-merge.ts` | 104 |
| user 消息 id=uuid（使 L30 不命中） | `src/stores/chat.ts` / `runtime-send-actions.ts` | 2576 / 201 |
| final 时调用去重 | `src/stores/chat/runtime-event-handlers.ts` / chat.ts | 171 / 内联 |
| history 加载时再调用去重 | `src/stores/chat/history-actions.ts` / chat.ts | 112 / 2160 |
| assistant-turn 分组（遇 user 才 break） | `src/pages/Chat/chat-display.ts` | 200-224 |
| 取最后一条有文本的回复 | `src/pages/Chat/chat-display.ts` | 257-262 |
| 渲染选中回复 | `src/pages/Chat/AssistantTurnMessage.tsx` | 101 |

> 附带隐患（非本次主因）：assistant 消息 id 兜底 `run-${runId}`（`runtime-event-handlers.ts:134` / `chat.ts:3061`），若 Gateway final 无 id 且 runId 为空，会塌缩成 `run-undefined`，那才是 React key 级碰撞。本次现象与它无关。

---

## 3. 关键可行性发现（决定方案走向）

> 这是选定「id 配对」方向前必须知道、但调研中才暴露的事实。

1. **乐观 user 消息的 `id` 从未发送给 Gateway。**
   `sendMessage` 在创建乐观 user 消息时生成 `id: crypto.randomUUID()`（chat.ts:2576 / runtime-send-actions.ts:201），但发给 Gateway 的载荷里用的是**另一个独立** `idempotencyKey = crypto.randomUUID()`（chat.ts:2679 / runtime-send-actions.ts:277）。两者是不同的随机 UUID，无任何共享值。
2. **Gateway 不回传 user 消息 id。**
   `chat.send` RPC 只返回 `{ runId }`（`openclaw-adapter.ts:197`、`engines/types.ts:59`）；`chat.history` 返回的 user 消息 `id` 为可选字段，前端从不为其合成 id。因此 `isSameUserMessage` 的 L30（`candidate.id === optimistic.id`）对服务端返回的 user 消息**实质是死代码**。
3. **Gateway 时间戳可能严重偏移。**
   现有测试 `tests/unit/user-message-merge.test.ts:9-40` 构造了乐观消息 ts=`1710000000`、history user ts=`1700000000`（偏移约 1000 万秒）的场景，正说明文本兜底（L47/L53）是**为补偿时间戳不可靠**而存在的兜底机制。
4. **结论：纯前端「只认 id」不可行。** 直接删掉文本兜底会导致「乐观消息 + 服务端 echo 同时显示」的重复闪烁回归。要让 id 真正可用于配对，**必须让 id 回环**（前端发出 ↔ 服务端持久化 ↔ history 回传）。

---

## 4. live 代码位置（实施时务必认清）

仓库内存在**两套** chat store 动作实现：

- **live（实际生效）**：`useChatStore`（`src/stores/chat.ts:1490`）使用 **chat.ts 内联实现**。
  - `sendMessage` @ `chat.ts:2472`（乐观 id ~2576、idempotencyKey 2679、dedupe ~2586）
  - `loadHistory` @ `chat.ts:2093`（dedupe ~2160）
  - `handleChatEvent` final @ `chat.ts:2802`（assistant msgId ~3061）
- **并行/未接入**：`src/stores/chat/*.ts` 模块化版本（`runtime-send-actions.ts`、`history-actions.ts`、`runtime-event-handlers.ts`、`internal.ts` 等）。`createInternalActions` 全仓未被任何地方引用，属未接入的重构代码。

> ⚠️ 实施时**主改 chat.ts 内联路径**；模块化版本同步修改以防后续接入踩坑。根因文件 `user-message-merge.ts` 为两套共享，是核心改动点。

---

## 5. 方案 A：id 回环（前后端）

### 5.1 前端改动

**(1) 复用乐观 id 作为 idempotencyKey** ✅ 已实现

`src/stores/chat.ts:2679` 与并行版本 `src/stores/chat/runtime-send-actions.ts:277`：

```diff
- const idempotencyKey = crypto.randomUUID();
+ const idempotencyKey = userMsg.id;   // 复用乐观消息 id，使其随请求回传
```

> 注：在后端回传 id 之前此改动是**惰性**的（仍是每次发送一个唯一 UUID），不改变行为；后端落地后即可形成 id 回环。

**(2) `dedupeRedundantUserMessages` 相邻性守卫** ✅ 已实现（前端安全方案）

> 实施时的关键修正：原计划「直接删 `isSameUserMessage` 的 L47/L53 文本兜底」**不可行**——`mergeOptimisticUserIntoHistory` 仍需文本匹配来探测「乐观消息 ↔ 服务端 echo」对（id 不回环、时间戳可能偏移），删掉会导致两者同时显示的重复闪烁回归。因此改在 `dedupeRedundantUserMessages` 内加**相邻性守卫**：把「跨 turn 合并」与「echo 合并」两个职责分开。

`src/stores/chat/user-message-merge.ts` `dedupeRedundantUserMessages` 内层循环改为：

```ts
// True duplicate (same id) — drop regardless of position.
if (first.id && second.id && first.id === second.id) { drop.add(j); continue; }

// Only ADJACENT user messages can be the same turn (optimistic + server
// echo, or a double insert). Two user messages separated by an assistant
// reply are distinct turns and must be kept — even when their text is
// identical. Collapsing them by text alone was the bug.
if (j !== i + 1) continue;

// Adjacent pair: drop if recognized as the same turn by content/time.
if (isSameUserMessage(second, first, refAt) || isSameUserMessage(first, second, refAt)) {
  drop.add(j); continue;
}
// Adjacent identical-text fallback.
if (firstText && firstText === secondText && attachmentsMatch(first, second)) { drop.add(j); }
```

- **`isSameUserMessage` 保持不变**（L47/L53 保留）：仅供 `mergeOptimisticUserIntoHistory` 探测 echo 用，其结果在 dedupe 中只对**相邻**对生效，不再跨 turn 误删。
- **非相邻同文本 user 一律保留**（不同 turn）—— 直接修复「重复输入覆盖上次输出」。
- **相邻同文本 / id 相等仍去重**（乐观 + echo 对 / 双插）—— 不回归重复闪烁。

此方案不依赖后端，即第 7 节的过渡方案；后端 id 回环落地后，id 相等的非相邻对也会被正确去重（兜底安全网），可无缝升级到完整方案 A。

### 5.2 后端改动（依赖，待验证，未实施）

**已有（无需改）**：
- `/api/chat/send`（`electron/api/routes/gateway.ts`）已透传 `idempotencyKey`。
- `electron/engines/openclaw-adapter.ts:195` 已把 `idempotencyKey` 放入 `chat.send` RPC 参数。

**需要（关键依赖）**：
- OpenClaw Gateway 将 `idempotencyKey` **持久化为 user 消息的 `id`**，并在 `chat.history` 返回的 user 消息中**回传该 id**。

**验证步骤**：
1. 发送一条消息，记录发出的 `idempotencyKey`（= 乐观 user id）。
2. 调用 `chat.history`，检查返回的 user 消息 `id` 是否等于该 `idempotencyKey`。
3. **已支持** → 仅前端改动即可，方案 A 完整生效。
4. **不支持** → 需推动 Gateway runtime 支持（可能超出应用层，需 runtime 负责人介入）；在此期间采用 5.1(3) 降级变体或第 7 节的过渡方案。

---

## 6. 测试更新

> 现有部分测试**固化了 bug 行为**，必须随修复一并改正。

### `tests/unit/user-message-merge.test.ts`

- **L9-40「history 已有同文本不追加乐观」**：**保持不变**。该用例测的是 `mergeOptimisticUserIntoHistory`（未改动），仍依赖文本兜底探测 echo，继续通过。
- **L69-79「移除连续重复 user」**：相邻同文本，**保持通过**（相邻规则仍去重）。
- **新增 ✅**：「preserves non-adjacent identical-text user messages as distinct turns」—— `[user-1, assistant-1, user-2, assistant-2]` 同文本，断言 4 条全保留（bug 场景正向用例）。
- **新增 ✅**：「drops a non-adjacent user duplicate only when ids match」—— 非相邻同 id 去重、id 相等兜底安全网。

### `tests/unit/chat-history-actions.test.ts`

- **L316-330 ✅ 已重写**：原「removes trailing duplicate optimistic user after assistant reply」（断言 `user-dup` 被丢，固化 bug）改为「preserves a repeated identical user message separated by an assistant reply」，断言 `[user-1, assistant-1, user-2]` 三条全保留。

### 验证结果 ✅

```bash
pnpm exec vitest run tests/unit/user-message-merge.test.ts tests/unit/chat-history-actions.test.ts
# 2 files, 12 tests 全部通过（修复前 2 个回归用例红，修复后绿）
```

全量 `pnpm exec vitest run` 对比（stash 前后 diff）：**本次改动引入 0 个新失败**；其余 42 个失败均为预先存在的环境问题（stale `dist-electron`、缺失模块、mock 报错等），与本次改动无关。`pnpm run typecheck` 同样无新增错误（均为预先存在的 TS6305/TS6133/TS2307）。

---

## 7. 文档同步 & 风险

### 文档同步（按 AGENTS.md Doc sync rule）
- 审阅 `README.md` / `README.zh-CN.md` / `README.ja-JP.md` 与 `docs/chat-send-flow.md`：`idempotencyKey` 现复用为乐观 user 消息 id（语义微调，行为不变），如需可补充说明。

### 风险与后续
- **当前前端方案不依赖后端**，已修复报告的 bug 且无回归。
- **Gateway id 回传（5.2）仍待验证**：若 runtime 支持，则 id 相等的非相邻对也会被 dedupe 兜底去重，升级到完整方案 A；若不支持，现状已是正确行为。
- **极端时间戳偏移 + 乐观/echo 非相邻** 的边角情况仍可能短暂重复，但实际流程中 echo 合并由 `mergeOptimisticUserIntoHistory` 在 dedupe 之前完成，命中率高。
- **工程红线**：本方案不触碰 `package.json` / lockfile / 构建配置 / CI；后端改动（若后续实施）仅限 `electron/api/routes/gateway.ts`、`electron/engines/openclaw-adapter.ts` 等应用层文件，Gateway runtime 侧改动需另行评估。

---

## 8. 本次交付范围 ✅ 已完成

- ✅ 根因分析与方案文档（本文件）。
- ✅ 前端实现：`dedupeRedundantUserMessages` 相邻性守卫（`src/stores/chat/user-message-merge.ts`）；`idempotencyKey = userMsg.id`（`src/stores/chat.ts:2679`、`src/stores/chat/runtime-send-actions.ts:277`）。
- ✅ 测试：重写 `chat-history-actions.test.ts` 回归用例、新增 `user-message-merge.test.ts` 2 个用例；相关用例全绿，全量无新增失败。
- ⏳ 后端 id 回传（5.2）待验证/推动，不阻塞当前修复。
