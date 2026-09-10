# R1b 设计：运行时内核补边与续跑协议

| 元信息 | 值 |
|---|---|
| 日期 | 2026-09-07 |
| 状态 | 待评审（Kimi K3） |
| 前置 | R0 止血已交付；R1a（query 唯一 owner + 空转防护）已交付 |
| 上游文档 | `docs/agent-loop-根因分析.md`（根因链）、`docs/agent-实现-code-review.md` |
| 一句话结论 | **不新建 SessionRuntime。**状态机、幂等骨架、per-session query owner 都已存在且合格；R1b 是补四个有证据的洞，每个洞独立可交付、独立有测试 |

---

## 零、与 Kimi 方案的分歧（先说清楚，再谈设计）

Kimi 的 R1 提案是"新建 `SessionRuntime`，新旧运行时并存 + feature flag 灰度"。核实现状后我**不同意新建**，理由是它要建的东西大部分已经在仓里：

| Kimi 提出要新建的能力 | 仓内现状 | 证据 |
|---|---|---|
| per-session query 生命周期唯一 owner | R1a 已交付 `ActiveQueryRegistry`，register 先 close 旧 owner、release 带 runId 防误删 | `electron/engines/active-query-registry.ts` |
| 状态机（相位 + 合法迁移边） | 已存在：10 个相位、`ALLOWED` 邻接表、终态不可变、runId 不匹配拒绝 | `electron/services/chat-runtime-transition.ts:23-64` |
| 幂等骨架 | 已存在：epoch 单调 + sequence 单调 + `upsertIfNewer` 拒 stale + idempotencyKey 10 分钟重放窗 | `chat-runtime-supervisor.ts:370-371`、`chat-runtime-repository.ts:142-146` |
| 看门狗 | 已存在 5 个：recovery idle / error finalization / hard deadline / history poll / transcript settle | `chat-runtime-supervisor.ts:788-1098` |
| loop 防护 | R1a 已交付，挂在 PreToolUse | `electron/engines/claude-loop-guard.ts` |

新建一个并存运行时的代价是聊天主链路双实现 + 灰度期两套 bug，收益是把上面这些已经通过测试的东西重写一遍。**风险收益不成立。** R1b 因此改为"就地补边"：下面 H1–H5 五个洞，全部有 `文件:行号` 级证据，全部可以单独上线。

---

## 一、H1：abort 不带 runId——停止按钮可能杀掉下一轮

### 现状

引擎侧 abort 契约里只有 `sessionKey`，没有 `runId`：

```61:63:electron/engines/types.ts
export interface EngineAbortParams {
  sessionKey: string;
}
```

Claude 的实现直接按 sessionKey 关掉"当前 owner"，不校验这个 owner 是不是发起 abort 那一轮：

```1748:1750:electron/engines/claude-adapter.ts
  async abortRun(params: EngineAbortParams): Promise<void> {
    activeClaudeQueries.abort(params.sessionKey);
  }
```

而状态机层**是**按 runId 校验的——`transitionChatRuntime` 会以 `run-id-mismatch` 拒绝错轮次的事件（`chat-runtime-transition.ts:54-56`）。也就是说：**投影层是 runId 正确的，执行层不是。**

### 竞态

1. 用户点停止 → `abortRun()` 取 `requestedSessionKey?.trim() || currentSessionKey`（`send-actions.ts:311`），发 `chat.abort`；
2. RPC 在途期间，消息队列用显式 sessionKey 起了下一轮（`message-queue.ts:360-361`），`ActiveQueryRegistry` 的 owner 已经换成 run B；
3. `abortRun` 到达，关掉的是 **run B**。用户看到的是"刚发出去的消息自己没了"，或者"停止按钮把新消息也停了"。

这正是 CR 里"停止按钮多窗口失效"那组症状的执行层根因：不是找不到句柄，是**杀错了句柄**。

### 设计

`EngineAbortParams` 增加可选 `runId`，`ActiveQueryRegistry` 增加"只在 runId 匹配时才 abort"的语义：

```ts
// electron/engines/types.ts
export interface EngineAbortParams {
  sessionKey: string;
  /** 发起 abort 的那一轮；不传表示"关掉当前任意 owner"（兼容旧调用方）。 */
  runId?: string;
}

// electron/engines/active-query-registry.ts
export type AbortOutcome = 'aborted' | 'idle' | 'stale-run';

abortIfCurrent(sessionKey: string, runId?: string): AbortOutcome
```

- `runId` 匹配 → close + 释放，返回 `aborted`；
- owner 存在但 runId 不匹配 → **不动它**，返回 `stale-run`；
- 无 owner → `idle`。

`stale-run` 必须一路回到 supervisor：`aborting` 相位不能停在那里等超时，而应立刻按"这次 abort 已过期"处理，把相位回退到 `running`（`ALLOWED.aborting` 已经允许 `aborting → running`，`chat-runtime-transition.ts:31`，这条边现在正好是为 abort 失败准备的）。

调用方补 runId：`send-actions.ts` 的 `abortRun` 从 store 里取当前 run 的 runId 一起发；HTTP 入口 `api/routes/gateway.ts:302-325` 同步。OpenClaw 侧 `abortRun` 透传给 Gateway `chat.abort`，Gateway 不认 runId 时保持现状（`runId` 可选，不构成破坏性变更）。

### 验收

- 单测：owner 是 run B 时用 run A 的 runId abort → owner 不变、返回 `stale-run`；
- 单测：`stale-run` 时 supervisor 把 `aborting` 回退 `running` 而不是等 watchdog；
- 不传 runId 的旧调用方行为逐字节不变。

---

## 二、H2：续跑决策散落三处，且中断原因不持久

### 现状

"新建还是 resume"是内联三元表达式，藏在 `startClaudeQuery` 中间：

```1255:1257:electron/engines/claude-adapter.ts
    const sessionId = existing?.sessionId || randomUUID();
    const runId = randomUUID();
    const queryMode = existing?.sessionId ? 'resume' as const : 'new' as const;
```

第二个决策点是完全独立的 recovery 路径（`consumeWithMissingSessionRecovery`，`:1405-1509`），只在 `isMissingClaudeConversationError` 时触发。第三个是 R0 加的中断注入，走一张**内存 Map**：

```304:311:electron/engines/claude-adapter.ts
  rememberClaudeInterrupt(sessionKey, error)   // query 失败时写
  consumeClaudeInterrupt(sessionKey)           // 仅 resume 模式读
```

两个问题：

1. **进程重启即失忆。**Map 在内存里，而 supervisor 恢复时对 active run 是 `epoch + 1` 并置 `reconciling`（`chat-runtime-supervisor.ts:243-245`）——恰恰是最需要告诉模型"上一轮为什么断"的场景，中断原因却已经丢了。
2. **原因粒度只有"有没有报错"。**`buildClaudeResumeInterruptAppend` 拿到的是 `lastError` 字符串，无法区分"用户主动停止"和"流被关闭"和"工具超时"和"被空转防护拦下"。这四种情况给模型的续跑指令应该完全不同：用户停止 → 不要自己接着干；空转防护拦下 → 换路子而不是重试；流关闭 → 用已有上下文续写。

### 设计

**一、中断原因进 run 快照，不进内存 Map。**`ChatRuntimeSnapshot` 已经持久化在 `chat_runtime_runs` 且有 `error` 字段，增加一个受控枚举：

```ts
export type ChatRunInterruptCause =
  | 'user_abort'        // 用户点停止
  | 'stream_closed'     // SDK 流关闭 / CLAUDE_CODE_STREAM_CLOSE_TIMEOUT
  | 'tool_timeout'      // 工具侧超时
  | 'loop_guard_blocked'// 被空转防护拦下
  | 'hard_deadline'     // 6h 硬超时
  | 'process_restart'   // 恢复启动时发现的 active run
  | 'unknown';
```

写入点是现成的：`aborted` 终态 → `user_abort`；`turn.failed` 的 error finalization → 按 error 归类；hard deadline watchdog → `hard_deadline`；supervisor 恢复路径 → `process_restart`；loop guard 拦截时由 hook 上报 → `loop_guard_blocked`。

**二、决策收敛成一个纯函数。**

```ts
// electron/engines/resume-plan.ts
export type ResumePlan =
  | { mode: 'new' }
  | { mode: 'resume'; resumeSessionId: string; interruptCause: ChatRunInterruptCause | null; isContinuePrompt: boolean }
  | { mode: 'recovery'; archivedSessionId: string };

export function resolveResumePlan(input: {
  registryEntry: { sessionId?: string } | null;
  priorRun: Pick<ChatRuntimeSnapshot, 'phase' | 'interruptCause'> | null;
  userPrompt: string;
}): ResumePlan;
```

纯函数、无 SDK 依赖、可穷举测试。`startClaudeQuery` 只负责执行 plan；recovery 路径从"第二个隐式决策"变成 plan 的第三个分支。`buildClaudeResumeInterruptAppend` 改成吃 `interruptCause` 枚举而不是 error 字符串，每个 cause 一段固定话术（话术文本继续放 `shared/claude-runtime-control-text.ts`，保持可测）。

**三、消灭空 turn。**当 plan 是 `resume` 且 `isContinuePrompt`（`isContinueUserPrompt` 已有）时，prompt 不能是空串或裸"继续"——必须带上 cause 段落，否则就是根因分析里 B 链的"模型收到空 user turn → 重新检查状态"。

### 验收

- `resolveResumePlan` 穷举测试：`registryEntry × priorRun.phase × interruptCause × isContinue` 的组合表；
- 集成测试：kill 进程后重启，`process_restart` 的 cause 出现在续跑的 systemPromptAppend 里（现在是丢失的）；
- 每个 cause 的话术断言（`user_abort` 必须包含"不要自行继续"）。

---

## 三、H3：systemPromptAppend 十处拼接，组装无 owner

### 现状

"提示词 10 处拼接"这句核实为真，逐一列出（这是根 3 的主标本）：

| # | 位置 | 拼什么 |
|---|---|---|
| 1 | `claude-runtime-extensions.ts:76-86` | 各 extension 自己 merge |
| 2 | `claude-runtime-extensions.ts:283-316` | `buildClaudeRuntimeOptions` 汇总 |
| 3 | `claude-adapter.ts:1627-1641` | memory 注入 + 调用方 append |
| 4 | `claude-adapter.ts:1277-1280` | cwd note + runtime + options + historyBridge + resumeInterrupt |
| 5 | `claude-adapter.ts:1449-1451` | recovery bridge |
| 6 | `shared/system-prompt-append.ts:5-14` | OpenClaw 走用户消息 |
| 7 | `shared/system-prompt-append.ts:21-29` | 定时任务封装 |
| 8 | `openclaw-adapter.ts:48-53` | 在 6/7 之间选 |
| 9 | `scheduled-task-service.ts:614-622` | 钉钉块 join |
| 10 | `bridge-ai-profile.ts:79-88` | JSBridge AI 技能段 |

后果是"哪段提示进哪种会话"没有任何地方说得清，也没有任何测试盖住——改一处忘一处就是线上事故。

### 设计

**不搬文本、不改措辞**（浅色冻结式原则：本轮只给组装找 owner）。引入一个有序段落表：

```ts
// shared/system-prompt-sections.ts
export interface SystemPromptSection {
  id: 'cwd' | 'runtime-extensions' | 'memory' | 'caller' | 'history-bridge'
    | 'resume-interrupt' | 'recovery-bridge' | 'scheduled-task' | 'bridge-ai-skill';
  /** 段落顺序即最终拼接顺序，显式声明，不靠调用点先后。 */
  order: number;
  text: string | null;
}

export function assembleSystemPromptAppend(sections: SystemPromptSection[]): string;
```

每个现有拼接点改为"产出一个 section"，最终只有一处 join。配套一张**会话种类 × 段落**的期望矩阵测试（interactive / embed / workflow / scheduled / bridge 五种），断言"哪段该在、哪段不该在"。改 ALLOWED 式的强制：动了组装就必须动期望表。

这一步是 R2"提示词 SSOT"的前置件，但它足够小、且直接消掉根 3 最大的标本，所以放进 R1b。

---

## 四、H4：ALLOWED 表无契约测试，相位 × 事件不穷举

### 现状

`ALLOWED` 邻接表是状态机的全部合法性依据（`chat-runtime-transition.ts:23-37`），但它**没有独立的契约测试**。现有最接近的测试只覆盖 5 个非终态 × `aborting`/`run.aborted`，共 6 个 case（`tests/unit/chat-runtime-transition.test.ts:72-105`）。

11 个事件类型 × 10 个相位 = **110 个组合，测了 6 个。**改 `ALLOWED` 的任何一格都不会有测试变红。

### 设计

1. **穷举矩阵**：`it.each` 跑满笛卡尔积，每格对照一张显式期望表（`accepted` / `terminal-is-immutable` / `invalid-transition`）。期望表和 `ALLOWED` 是两份独立声明，改一份另一份必须同步——这正是 Kimi 说的"K2 相位×事件穷举测试当验收器"。
2. **看门狗不变量**：Kimi 提的"进相位即武装看门狗"落成断言——进 `uncertain` / `reconciling` / `awaiting_transcript` 之后必须有 recovery timer 处于武装状态；进任一终态之后 5 个 timer 必须全部清零（`clearRecovery` / `clearErrorFinalization` / `clearHardDeadline` / `clearHistoryPoll` 已存在，只是没人断言它们真被调用）。

H4 先做，因为 H1/H2 都会动状态机行为，需要先有这张网。

---

## 五、H5：执行经验把 bug 症状学成了最佳实践（自我强化回路）

这是我在 R1b 调研期间从本机 mem0 里查到的新证据，性质上属于运行时内核问题——**它让所有 harness bug 变成永久性行为退化**，所以并进 R1b。

### 现场

本机 mem0（`~/Library/Application Support/stoclaw/mem0/vector-cache/memories.json`）共 226 条，其中 `execution` scope 91 条。以下三条是妙悟事故的直接教材：

| 条目 | 写入时间 | 教给模型什么 |
|---|---|---|
| `fbcae8f9` | 2026-09-04 06:14 | "sessionId 格式为 `ext-{numbers}-{uuid}`" + "**避免** `bridge_screenshot`（浏览器插件权限不足…`<all_urls>` 或 `activeTab` 权限缺失）" |
| `87b5e775` | 2026-09-04 07:46 | "任务复杂度较高时**必须**使用 TaskCreate 拆解四步" + "调用浏览器工具前**必须**先 `bridge_list_sessions`" + "**避免** screenshot/read_page" |
| `4fc174c0` | 2026-09-04 07:54 | "`TaskCreate(...)` **标准起手式**" + "**必须**使用 TaskCreate 分阶段编排" |

两点要命：

1. **它把幻觉固化成了规则。**"截图失败 = 插件权限不足"本来是模型对一次工具失败的错误转述（根因分析 §一 的原始症状），现在它以"避免"条目的形式写进了长期记忆，还带上了伪造的技术细节（`<all_urls>`/`activeTab`）。以后每一轮都会读到"screenshot 不可用"。
2. **它把编造 sessionId 的模板写进了记忆。**`ext-{numbers}-{uuid}` 这个格式串加上"必须先 list_sessions"的约束，正是 16 次连点里 13 个不存在 sessionId 的来源——模型不是随机瞎猜，它在**按记忆里的格式合成**。
3. **写入时间在事故中间**（07:46 / 07:54 落在妙悟会话 07:44–08:06 内）：一次失败的执行被当场蒸馏成 playbook。

`claude-execution-summary-service.ts:109` 已有"工作流执行不沉淀"的守卫，但**没有任何"失败的执行不沉淀"的守卫**。

### 设计

写入端加质量门，判定数据全部现成：

```ts
// 拒绝沉淀的条件（任一命中即不写）
- run 终态是 failed / aborted / interrupted（快照里就有）
- 本轮触发过 loop guard 拦截（H2 的 loop_guard_blocked 一并上报）
- 本轮出现过 SESSION_STALE 自愈（说明会话语义本身不可靠，不该固化 sessionId 用法）
- 蒸馏文本里出现工具能力否定式（"避免 <工具名>"）而该否定来自单次失败
```

最后一条最重要：**"避免某个工具"这类结论不允许由单次失败产生**，因为工具失败在我们这儿绝大多数是 harness 问题（root 2 的原形），而记忆一旦学会"绕开工具"就再也不会去验证它是否已修好。

已污染的 91 条 execution 记忆需要一次运行时清理，代码改不掉——见"待你确认的删除清单"（另附，只读已完成，未执行删除）。

---

## 六、交付顺序与风险

| 步 | 内容 | 依赖 | 风险 |
|---|---|---|---|
| 1 | **H4** 穷举矩阵 + 看门狗不变量 | 无 | 零风险（纯增测试），可能立刻暴露现存非法边 |
| 2 | **H1** abort 带 runId | H4 | 低；`runId` 可选，旧调用方行为不变 |
| 3 | **H2** `resolveResumePlan` + cause 持久化 | H4 | 中；动主链路续跑决策，需要 DB 加一列 |
| 4 | **H3** 提示词段落表 | 无 | 低；只改组装不改文本，有期望矩阵兜底 |
| 5 | **H5** 沉淀质量门 | H2 的 cause | 低 |

**不做 feature flag、不做并存运行时**——每步都足够小，测试足够密，灰度成本高于收益。

### 明确不在 R1b 范围（与 Kimi 已达成一致）

- 上下文管理（artifact 落盘 / digest / 历史窗口）→ R2/L3。resume 只传 sessionId、transcript 由 CLI 自读，这是真实成本但不构成换内核的理由；
- CDP 层、AX 感知层、workflow 重试模式 → 合格设计，不动；
- 167 个 node 侧类型错误 + 陈旧测试（`openclaw-doctor` 5 连挂、`thinking-claude-done` 弱 id 那条）→ 基线债单独立项。注意 `thinking-claude-done` 失败的那条测试**是对的**：它测"同名弱 id、不同入参的工具必须各自保留"，而妙悟那份 transcript 里 83 次调用只有 20 个不同 `tool_use` id（24 条不同 Bash 命令全挤在 `toolu_Bash_0`）——测试红得有道理，源码该修。

### 验收标准（沿用 Kimi 的可测口径）

同一个"妙悟建站"任务，对照 Kimi 轨迹：回合数 ≤ 2 倍、零假执行（echo 类）、零死循环、失败时模型自述的错误 = 原始 error 原文、停止按钮一次生效且不误杀下一轮。
