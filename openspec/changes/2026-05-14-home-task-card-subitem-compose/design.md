## Context

- 上游 `proposal.md` 已定：动态子项（本地日、同日复用）、每卡片默认 prompt、网关就绪后再发送并等待本轮回答、子项聊天独占且**不在**普通会话列表再增并列项、侧栏子项行尾未读红点（对齐 `docs/sto-design.md` 的 **Danger / 提醒**语义，避免随意色值）。
- 应用栈：React 19、Zustand（`src/stores/chat` 等）、Gateway RPC（`sessions.list` 等）、host-api / api-client；渲染进程不直连 Gateway HTTP。

## Goals / 非目标

- **Goals**：卡片点击可复现地创建或复用当日子项并进入子项聊天面；默认 prompt 注入与「就绪后发送 + 等本轮结束」可测试；侧栏未读与已读一致；全局聊天列表**不**出现第二条用户可感知的「同一子项对话」。
- **非目标**：服务端报表、跨设备同步子项、推送通知；折叠侧栏内完整子项文案策略（可沿用既有「折叠弱化」取舍）；OpenClaw 服务端会话治理策略的改造（除非验证发现 key 非法）。

## 关键决策

### 1) 子项机器标识与路由：`entryId = YYYY-MM-DD`（本地日历）

- **Rationale**：与 proposal「点击瞬间本地日期」一致；URL 稳定、可排序、易与 i18n 展示标题（「xxxx年XX月XX日的材料」）映射；与既有 `taskDetailPath` 形状兼容。
- **Alternative considered**：纯 UUID — 对人类不可读、侧栏难排序；`latest` 单段 — 与「同日主键复用」冲突。

### 2) 子项注册表：渲染侧「主任务 → 有序 entryId 列表」+ 持久化

- **Rationale**：侧栏列表不能仅靠静态 `STO_TASK_ENTRIES`；需在应用重启后仍能列出已创建子项（否则违反「材料」入口预期）。使用 **Zustand + electron-store（或项目既有持久化模式）** 存 `Record<StoTaskId, string[]>`（新日插前、同日不重复）。
- **Alternative considered**：完全依赖 Gateway `sessions.list` 反推子项 — 列表噪声大且与「全局列表不展示」强耦合过滤规则；离线无网关时侧栏为空体验差。

### 3) 子项独占会话与全局列表：专用 `sessionKey` 命名空间 + UI 过滤

- **Rationale**：与既有 `useChatStore`（`sessions`、`switchSession`、`sendMessage`）对齐，复用同一套消息收发与 transcript，避免双轨消息引擎。为每个 `(taskId, entryId)` 派生**稳定且唯一**的 `sessionKey`（建议落在既有 `agent:<agentId>:…` 可接受后缀空间内，例如包含可解析片段 `sto-task:<taskId>:<entryId>`，**具体字面量在 spec/tasks 实现前用 Gateway 实测确认**）。
- **产品语义落地**：聊天页（及任何「普通会话列表」组件）在展示 `sessions` 时 **MUST** 过滤掉任务子项专用 key，使用户**看不到**并列项；任务子项页在 `switchSession(taskSessionKey)` 后独占展示 `messages`。
- **Alternative considered**：子项 UI 自建本地假聊天 — 与 host-api / 流式事件重复实现；**Alternative**：发送后 `navigate('/chat')` — 与 proposal「会话仅在子项框内」冲突。

### 4) 卡片点击后的「发送意图」传递：导航状态 + 一次性消费

- **Rationale**：避免 URL query 承载长 prompt；避免刷新重复自动发送。使用 `react-router` **location state**（或等价）携带 `{ defaultPromptKey 或 短 token, autoSend: true, sourceCardId }`，子项页 `useEffect` **消费一次即清除**（内存 + replace navigation 去 state）。
- **Alternative considered**：仅 sessionStorage — 可支持新标签打开同一 URL 的边界，但需额外防重；可在实现阶段与 location state 二选一或组合。

### 5) 网关未就绪 → 就绪后再发送：子项页内订阅 + 队列单飞

- **Rationale**：与 proposal 一致；避免 toast 即放弃。子项挂载后若存在未消费的 `autoSend` 意图且 `gateway.state !== 'running'`，**不调用** `sendMessage`；订阅 gateway store，**首次变为 running** 时触发发送逻辑；若用户离开子项页，**取消**未发送的自动发送（或写入「待发送」到该子项元数据 — 非目标，不默认做）。
- **Alternative considered**：全局轮询 IPC — 与现有 gateway store 重复；阻塞 Modal 直到就绪 — 打断材料阅读流。

### 6) 「等待本轮回答输出完成」的判定

- **Rationale**：与未读红点联动需要稳定边界。采用 **chat store 已有流式终态**：该轮 `sendMessage` 触发的 run 结束（`sending === false` 且与本轮关联的 `pendingFinal`/activeRun 清理完成，或项目已有之「run 完成」信号）。**spec 中**用 SHALL 绑定到 store 的明确字段名（实现时与 `chat.ts` 对齐）。
- **Alternative considered**：首块 assistant token 即算完成 — 与流式体验不符；仅依赖 WebSocket 某一事件 — 与多传输回退策略耦合过紧。

### 7) 未读 / 已读

- **未读置位**：当子项会话中出现**新的**助手可见输出（本轮完成后），且当前路由**不是**该子项页，或用户未满足已读条件 — 置 `unread[taskSessionKey]=true`（或按 `(taskId,entryId)` 存）。
- **已读清除**：当用户进入该子项路由 **且** 聊天内容已加载 **且** 已展示最新助手消息（最小实现：进入子项页并成功 `loadHistory` 后一次 `queueMicrotask` 清除；更细粒度滚动到视口内留给后续迭代）。
- **Rationale**：侧栏红点与 proposal 一致；避免「未打开子项但已读后」误清除 — 以路由 + 历史加载为准。
- **Alternative considered**：依赖窗口 focus — Electron 多窗体时不可靠。

### 8) 默认 prompt 与展示标题

- **Rationale**：proposal 要求 i18n。在 `home`（或 `tasks`）命名空间用 **`cardId` / `taskId` 键**映射默认 prompt；侧栏子项标题用 i18n 模板 + 日期参数（各语言 `Intl` 或等价），禁止组件内硬编码中文长句。
- **Alternative considered**：单条通用 prompt — 与「每卡片一句」冲突。

### 9) 与 `useHomeChatEntrySend` 的关系

- **Rationale**：该 hook **内含** `newSession()` 与 `navigate('/chat')`，与子项独占会话、留在任务页冲突。子项自动发送 **MUST** 走「子项专用路径」：不切主会话列表可见项、不导航到 `/chat`；可抽取「仅发送 + question:split」的共用函数，或子项页显式 `switchSession(taskSessionKey)` 后调用 `sendMessage`（**不**调用 `newSession()` 若会生成新的主列表项）。
- **Alternative considered**：子项内复制一套 IPC — 违反 DRY 与 host-api 边界。

## 主题与侧栏徽标（`docs/sto-design.md`）

- 子项行尾未读圆点：**Danger / 提醒**语义色（参见设计宪法中的 Danger 文本或点缀用法），尺寸保持侧栏可读性下限（具体 px 在实现中按现有侧栏密度取值）。
- 子项选中态：延续中性灰阶表面（**Grey-2 / Grey-3 意图**），与主导航 Brand 强调区分（与 archive home-task-list design 一致）。

## Risks

- **[Risk]** Gateway 拒绝含 `sto-task` 片段的 session key 或长度超限 → **Mitigation**：实现前对 `sessions.list` / 创建会话路径做探测；必要时缩短前缀或改用允许的编码（仍保持可解析）。
- **[Risk]** `sessions.list` 过滤若仅做 UI 而其他地方仍暴露 key → **Mitigation**：会话列表数据源单点过滤；E2E 覆盖「子项发消息后聊天侧栏无新会话名」。
- **[Risk]** 同日复用 + 再次自动发送导致用户未预期第二条用户消息 → **Mitigation**：与 proposal 一致为预期行为；可选在 spec 中写清「每次点击卡片均再发一轮」。
- **[Risk]** `loadSessions` 与任务页 `switchSession` 竞态导致闪错会话 → **Mitigation**：子项页 mount 顺序：`switchSession` → `loadHistory` → 再消费 autoSend；设计在 tasks 中写清顺序。

## 开放问题（实现 / spec 前可收口）

- 任务子项是否使用**固定 agentId**（如 `main`）还是卡片可绑 agent — proposal 未强制；默认与首页助手一致用当前默认 agent，**若多卡片需不同 agent 在 spec 增加映射**。
- 子项页是否保留「返回首页」与弱报表占位 — proposal 以聊天为主；layout 取舍留给实现 PR 与产品确认。

## 下游产物

- **specs**：在 `home-task-list-surface`（及会话列表相关 capability，以 `openspec/specs` 现有文件名为准）中增加 SHALL/MUST 与 `#### Scenario:`。
- **tasks**：按 requirement 拆解；若触碰 gateway 收发路径，执行 `pnpm run comms:replay` 与 `pnpm run comms:compare`（见 `openspec/config.yaml`）。
