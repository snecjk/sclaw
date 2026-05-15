## Context

- 上游 `proposal.md` 已定：**新建**当日子项 → 自动发送该卡片绑定 prompt（网关就绪后）；**已存在**当日子项 → 仅导航 + 聊天区滚底、不注入 prompt、不自动发送；动态子项、同日复用、子项独占会话、全局列表无并列项、侧栏未读红点（对齐 `docs/sto-design.md` **Danger / 提醒**）。
- 应用栈：React 19、Zustand、`sessions.list`、host-api / api-client；渲染进程不直连 Gateway HTTP。

## Goals / 非目标

- **Goals**：卡片点击可复现地区分「新建 + 自动发」与「复用 + 滚底」；新建路径下默认 prompt 与「就绪后发送 + 等本轮结束」可测试；复用路径下无代发、滚底可靠；侧栏未读与已读一致；全局聊天列表无第二条并列项。
- **非目标**：同日复用路径再次自动发送；服务端报表、跨设备同步；OpenClaw 会话治理大改（除非 key 非法）。

## 关键决策

### 1) 子项机器标识与路由：`entryId = YYYY-MM-DD`（本地日历）

- **Rationale**：与 proposal 一致；URL 稳定、可排序、与 i18n「xxxx年XX月XX日的材料」映射。
- **Alternative considered**：纯 UUID — 不可读、侧栏难排序。

### 2) 子项注册表：渲染侧「主任务 → 有序 entryId 列表」+ 持久化

- **Rationale**：侧栏与重启后列表须持久；**Zustand + electron-store**（或项目既有模式）存 `Record<StoTaskId, string[]>`，同日不重复。

### 3) 子项独占会话与全局列表：专用 `sessionKey` + UI 过滤

- **Rationale**：复用既有 `useChatStore`；`sessionKey` 命名见既有 design；聊天列表 **MUST** 过滤子项 key；子项页 `switchSession` 后独占 `messages`。

### 4) 首页点击后的「意图」传递：必须区分新建 vs 复用

- **Rationale**：两路径行为不同，**不得**仅靠「是否同日」在子项页内猜测（避免深链直达 `/tasks/.../2026-05-15` 时误判）。首页（或创建子项的同一事务）在 `navigate` 时 **MUST** 携带显式分支，例如 `location.state`（或等价）之一：
  - **`{ entryBootstrap: 'created', autoSendPromptKey: '<cardBase或task映射键>', ... }`** — 本次因新建当日子项进入，允许在子项页消费自动发送；
  - **`{ entryBootstrap: 'reused', scrollToLatest: true }`** — 本次因复用当日子项进入，**禁止**自动发送，仅滚底。
- **消费规则**：子项页 `useEffect` 读 state 后 **立即 replace 掉敏感/一次性字段**，防刷新重复；**`entryBootstrap: 'reused'`** 时 **MUST NOT** 设置任何会触发 `sendMessage` 的标志。
- **Alternative considered**：仅用「注册表是否刚写入」推断 — 竞态与深链不可靠。

### 5) 网关未就绪 → 就绪后再发送（**仅** `entryBootstrap === 'created'` 且存在有效 `autoSend` 意图）

- **Rationale**：与 proposal 一致；**复用路径无 autoSend**，不得订阅后误发。子项挂载后仅当意图为新建且网关未就绪时等待；**首次 `running`** 触发发送；用户离开页可取消未发送意图（默认不写磁盘队列）。

### 6) 「等待本轮回答输出完成」（**仅**新建路径自动发送触发的该轮）

- **Rationale**：未读红点仍绑定 store 流式终态（`sending`、run 清理等，与 `chat.ts` 对齐）。复用路径无本轮自动发送，不适用「等本轮结束」判定。

### 7) 未读 / 已读

- **未读置位**：新建路径自动发送完成后、或任意路径下助手新输出完成，且用户未满足已读条件 — 置未读 + 红点。
- **已读清除**：进入子项路由且历史加载完成且满足 design 最小已读条件 — 清除。
- **Rationale**：与 proposal 一致。

### 8) 卡片 prompt 与展示标题

- **默认用户 prompt**：**仅**在 **`entryBootstrap === 'created'`** 时由子项页（经网关就绪逻辑）作为**用户消息内容**发送；文案 **MUST** 来自 i18n（`cardBase` / `taskId` 键），禁止组件内硬编码长句。
- **复用路径**：**MUST NOT** 向输入区注入该 prompt；输入区保持用户离开时的状态或空规则由实现定，但 **不得** 代发。
- **子项标题**：侧栏与详情主标题 i18n 模板 + 日期，「xxxx年XX月XX日的材料」语义。

### 9) 复用路径：滚动至会话底部

- **Rationale**：用户继续阅读最新上下文。须在 `loadHistory`（或消息已就绪）完成后执行 `scrollTo` 底部或既有 stick-to-bottom 钩子；若列表为空，滚底仍为合法 no-op。
- **Timing**：须在 `switchSession` 且历史加载完成后，避免滚到错误会话。

### 10) 与 `useHomeChatEntrySend` 的关系

- **Rationale**：该 hook 会 `newSession` + `navigate('/chat')`，与子项独占冲突。首页与子项 **MUST** 走专用路径：`switchSession(taskSessionKey)` + 条件 `sendMessage`；**不**跳 `/chat`。

## 主题与侧栏徽标（`docs/sto-design.md`）

- 未读圆点：**Danger / 提醒**语义；子项选中态中性灰阶，不用 Brand-6 铺整条背景。

## Risks

- **[Risk]** Gateway 拒绝子项 `sessionKey` 形态 → **Mitigation**：实测 `sessions.list` / 创建路径；必要时缩短编码。
- **[Risk]** 列表过滤遗漏导致并列项 → **Mitigation**：单点过滤 + E2E。
- **[Risk]** `entryBootstrap` 缺失（旧书签直链）→ **Mitigation**：缺省视为 **`reused`**（不自动发、可滚底），与「仅通过首页卡片应出现自动发」一致；若产品要求直链也发，须在后续 change 单独立项。
- **[Risk]** `loadSessions` 与 `switchSession` 竞态 → **Mitigation**：`switchSession` → `loadHistory` → 再分支「滚底 / 消费 autoSend」。

## 开放问题

- 多卡片是否绑定不同 `agentId` — 默认与首页助手一致；若需映射在 spec 补充。
- 子项页次要报表占位 — 实现 PR 与产品确认。

## 下游产物

- **specs**：更新 `home-task-list-surface`、`task-subitem-chat-compose-surface` 之 SHALL/Scenario（含复用滚底、新建自动发分支）。
- **tasks**：拆分两条路径的实现与测试；若触碰 comms，执行 `pnpm run comms:replay` 与 `comms:compare`。
