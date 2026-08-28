# Composer 三处样式一致 — 乐观更新 / 模型回显 / 编辑回填

> 状态：**Chat 主路径已落地**（阶段 A–D）；Task 装配接线后置  
> 日期：2026-08-12  
> 验收优先：**Chat 主路径**（用户气泡 + 乐观 overlay + history 配对 + 编辑回填）  
> 实现原则：**能力沉在共享底层**（store / lib / 可复用组件）；本迭代用 Chat 验证，**Task 等场景后置接线即可快速复用**，禁止写成 Chat 专用分叉  
> 前置：[`Composer内联混排-Segment模型与多SkillWorkflow透传.md`](./Composer内联混排-Segment模型与多SkillWorkflow透传.md)（阶段 1–6 已落地）  
> 产品目标：**乐观更新、模型返回替换、编辑回显 — 三处样式一模一样**

### 修订记录

1. **2026-08-12**：初稿。现象：工作流执行中双用户气泡；钉钉 @ 在乐观/最终/编辑三态颜色不一致。定稿根因与分阶段修复顺序。
2. **2026-08-12**：明确分层——Chat 只是首个验收面；配对/回写/segments 渲染等能力落在共享底层，供 Task 后续快速复用。
3. **2026-08-12**：补充复现——单文件气泡双份 + 终态泄漏 `[文件: …]`；双文件+技能+钉钉混排在模型返回后「错落」（chip 与占位文案叠床架屋）。乐观态均为正确参考态。
4. **2026-08-12**：**阶段 A–D 已落地**——共享 `UserComposerSegmentsContent`（mention→`DingTalkMentionTag`）；配对剥离 workflow/`[文件:]`/`[技能:]`；首次 echo 清乐观；display 防双挂；回写 `_composerSegments`/`content=displayText`；旧消息 strip + synthesize 按占位还原顺序；编辑 draft 禁脏占位。

---

## 1. 背景与现象

### 1.1 已落地基线

内联 Segment 模型、多 skill/workflow、`gatewayText` 位置语义 bake、气泡 `UserComposerSegmentsContent`、编辑 `setSegments` 已在 Chat 主路径落地。  
发送链路仍是：

```text
buildComposerGatewayPayload
  → displayText + gatewayText + attachments + skillMetas + persistedSegments
  → 乐观 RawMessage（content=displayText + _composerSegments + …）
  → dispatch（message=gatewayText + media + dingTalkMentions extras）
  → chat.history 回传 user
  → 配对 / 清乐观 / 投影展示
```

**关键约定（前置文档阶段 6）**：`[文件: …]` / `[技能: …]` **只属于发给模型的 `gatewayText`**，**不得**进入气泡 `displayText` / `content`。乐观路径遵守了这一点；history 回显路径目前经常没有。

### 1.2 当前可见缺陷

| # | 现象 | 中间态 | 终态 | 乐观参考 |
|---|------|--------|------|----------|
| 1 | 工作流：思考/调工具期间 **两条相同用户提问** | 双气泡 | 通常收敛为一条 | 单条、样式正确 |
| 2 | 钉钉 @：乐观黑 / 终态蓝 / 编辑又黑 | 不一致 | 仍不一致 | 若有 mention segment 则黑（渲染漏） |
| 3 | **单文件**：chip + 正文「将表中的数据生成一份 json」 | 双气泡：一条带泄漏文案，一条接近乐观 | **仍错误**：chip 后多出 `[文件: 店铺库存_….xlsx]` | **正确**（仅 chip + 人话，无占位串） |
| 4 | **复杂混排**（双文件 + 技能 + 生成 html + 发钉钉 @） | 模型返回后气泡「错落」：文件/技能 chip 堆在上方或前方，正文里又露出 `[文件: …]` / `[技能: …]`，与输入时 inline 顺序不一致 | 常保持错落（或编辑框也带占位串） | **正确**（文件/技能 inline chip，正文无占位，@ 在句末） |

说明：#3 / #4 证明问题不只是「双份」，还有 **模型侧 bake 文案泄漏进 UI**，以及 **丢失 `_composerSegments` 后 synthesize 把 chip 与占位正文叠在一起**。

### 1.2.1 单文件复现（对应截图：执行中双份 → 终态泄漏）

**输入 / 乐观（正确）**

```text
[文件 chip: 店铺库存_….xlsx  136.2 KB] 将表中的数据生成一份 json
```

**模型返回过程中（错误 · 双份）**

```text
气泡 A（history 脏）：[文件 chip] [文件: 店铺库存_….xlsx] 将表中的数据生成一份 json
        ↕ 中间夹着「思考 N 次…」
气泡 B（乐观干净）：[文件 chip] 将表中的数据生成一份 json
```

**整轮结束后（仍错误 · 单条但脏）**

```text
[文件 chip] [文件: 店铺库存_….xlsx] 将表中的数据生成一份 json
```

→ 双份会随 completed 消失，但 **`[文件: …]` 泄漏留在终态**，说明「清乐观 ≠ 回显样式正确」。

### 1.2.2 复杂混排复现（双文件 + 技能 + 钉钉）

**输入 / 乐观（正确 · inline）**

```text
使用 Excel 文件 [文件chip A] 和 [文件chip B] 使用技能 [技能chip] 生成一份 html，并发送给 [@mention]
```

（结构来自 `_composerSegments`：text / file / text / file / text / skill / text / mention。）

**模型返回后（错误 · 错落）** 典型形态：

```text
[文件chip A] [文件chip B] [技能chip]     ← chip 被提到气泡前部/顶部
使用Excel文件[文件: A.xlsx] 和 [文件: B.xlsx] 实用技能 [技能: 标题] 生成一份 html，并发送给 @名
```

特征：

1. **同一实体出现两次**：既有 UI chip，又有 gateway 占位明文。  
2. **顺序错落**：不再是「字–chip–字–chip」的 inline 混排，而变成「chips 一坨 + 带占位符的脏正文」。  
3. 编辑回填若吃了脏 `content` / 退化后的 segments，输入框也会出现同样的 `[文件:]` / `[技能:]` 字面量。

根因与 #3 同源，只是多 skill / 多 file / mention 时更刺眼。

### 1.3 产品目标（锁定）

同一条用户提问，在下列三处 **视觉与结构一致**（含技能 / 工作流 / 文件 / 钉钉 @ chip）：

1. **乐观更新**（点击发送后立刻出现）  
2. **模型返回替换后**（history 配对收敛为单条后的气泡）  
3. **编辑回显**（「编辑」写回 Composer 输入框）

### 1.4 范围分层（验收面 ≠ 实现面）

| 层级 | 本迭代怎么做 | 说明 |
|------|--------------|------|
| **共享底层** | **必须改到位** | 配对、清乐观、segments 回写、mention/chip 渲染、edit draft 读 segments — 放在 `stores/chat/*`、`lib/*`、可抽离的展示组件；**不**按「仅 Chat」写死分支 |
| **Chat 装配** | **首个接线 + 手工验收** | `ChatInput` / `ChatMessage` / 对话页编辑入口先用上底层能力 |
| **Task / 其它 Composer** | **本迭代不改装配 UI** | `TaskInstructionComposer` 等保持现状可编译可用；待切 inline / 对话式回显时 **只接线、不重写** 底层 |

原则：

1. **能力通用，场景 opt-in**：与前置文档的 `inlineAttachments` 思路一致——内核与 merge 层默认具备能力，场景层决定何时打开。  
2. **禁止 Chat-only 分叉**：例如不要在 `isSameUserMessage` 里写死 `if (isChatPage)`；workflow bake 剥离、segments 回写应对所有走同一 runtime 的会话生效。  
3. **可抽则抽**：若 `UserComposerSegmentsContent` 仍埋在 `ChatMessage.tsx`，本迭代应抽到共享模块（如 `components/input-composer/`），Chat / 未来 Task 气泡共用。  
4. **Task 复用清单（跟进迭代）**：打开 inline segments → 发送带 `_composerSegments` → 若有乐观/history 则自动吃到底层配对与回写 → 气泡/编辑复用同一渲染与 `setSegments`。

非目标（本迭代）：

- 不改 Gateway RPC schema（仍不增加结构化 skill/workflow/mention 字段）。  
- **不要求本迭代改完 Task UI / 任务描述气泡**（但底层改动不得堵死 Task）。  
- 不把 `gatewayText` 占位符（`[文件:]` / `[技能:]`）泄漏进气泡 `content`。

---

## 2. 根因分析

### 2.1 问题 1：工作流执行中双气泡

显示模型（`buildChatDisplayModel`）：

```text
messages = projectedMessages ?? transcript
若 overlay.optimisticUserMessage 的 id 不在 messages 中 → append 乐观
```

清乐观的主要条件：

| 路径 | 条件 |
|------|------|
| `setTranscript` | history 中存在 **同 id**，或 runtime **已 completed** 且本轮已收敛 |
| `clearOptimisticUserIfEchoed` | `findHistoryUserEcho` / `isSameUserMessage` 配对成功 |

工作流场景的典型错位：

| 字段 | 乐观 | Gateway history 回显 |
|------|------|----------------------|
| `content` | `displayText`（如「执行这个工作流」，**无** exec 句） | 含 `帮我执行 id 为：…的工作流 【名称】…` |
| `id` | 客户端 UUID（idempotencyKey） | 常为另一套 id（未稳定回传） |
| `_composerSegments` | 有（含 workflow） | 通常无；气泡靠正则反解析 |

结果：

1. history 已出现用户提问（合成 chip，看起来正常）。  
2. 乐观因 **文案对不上 + id 不同** 清不掉。  
3. 投影层再 append 乐观 → **双气泡**。  
4. 整轮 `completed` 后 `transcriptSettled` 才清乐观 → 看起来「好了」。

对比：带 `_skillMeta` 时 `isSameUserMessage` 有时间窗宽松匹配，技能路径较少踩中；**工作流 / 纯文件**没有等价宽松配对，且 file 场景 `content` 因占位符差异更大（见 §2.3）。

### 2.2 问题 2：钉钉 @ 三态颜色不一致

两条缝叠在一起：

**缝 A — 气泡有 `mention` segment 时画成黑字**

`UserComposerSegmentsContent` 对 `mention` 直接输出 `@{displayName}` 纯文本，**未**使用 `DingTalkMentionTag`（蓝色 `#1677FF`）。  
乐观带完整 `_composerSegments` → 走这条 → **黑**。

**缝 B — history 后 mention 退化成纯文本，编辑无法还原 token**

- optimistic→history 合并目前对 skill 主要 patch `_skillMeta` + `content`，**不回写** `_composerSegments`（含 mention 对象）。  
- 回显气泡常靠 `synthesizeComposerSegments` / `renderUserMessageMentionNodes` 对正文 `@xxx` **正则染蓝** → 看起来「最终态正常」。  
- 「编辑」若带的是「text 里含 `@名`」的 segments（或无 mention segment），`setSegments` 只插纯文本，**不会**调用 `createMentionSpan` → 输入框 **黑**。

因此：最终态蓝是「另一条渲染路径碰巧正确」，不是与乐观/编辑共用同一组件树。

### 2.3 问题 3 / 4：gateway 占位泄漏 + 混排错落（文件 / 技能）

阶段 6 之后，发给模型的正文形如：

```text
…使用Excel文件[文件: A.xlsx] 和 [文件: B.xlsx] 使用技能 [技能: 标题] …
```

乐观气泡用的是 **另一份** 数据：

| | 乐观 | history 回显（现状） |
|---|---|---|
| `content` | `displayText`（**无** `[文件:]` / `[技能:]`） | 常为 gateway 落库串（**含**占位 + 可能的 media attached / skill prompt / 钉钉块） |
| `_composerSegments` | 完整 inline 顺序 | 通常缺失 |
| `_attachedFiles` | 有 | 常从 `[media attached:]` 重建 |

气泡侧在无 `_composerSegments` 时走 `synthesizeComposerSegments`：

1. 把 `_attachedFiles` **一律推到 segments 前部**（文件 chip 置顶）→ 与输入 inline 顺序不符 → **错落**。  
2. 正文 `text` 若仍含 `[文件: …]` / `[技能: …]`，会作为 **text segment 原样画出** → **chip 与占位明文双显**。  
3. 技能同理：可能同时出现橙色 skill chip + 正文 `[技能: …]`。

配对失败时（乐观 display ≠ 脏 gateway content）：

- 执行中：**脏 history 气泡 + 干净乐观气泡** 并存（单文件截图中间态）。  
- 结束后：乐观被清掉，只剩脏 history → 终态仍带 `[文件: …]`（单文件截图终态）。

结论：#3 / #4 与 #1 共用「配对失败」；并额外要求 **展示层永远以 displayText + `_composerSegments` 为准，禁止把模型占位当 UI 文案**。

### 2.4 统一抽象失败点

目标态应是：

```text
_composerSegments（权威）+ content=displayText（无人话外的 bake）
  ├─ 乐观气泡
  ├─ 回显气泡（配对后回写到同一条 RawMessage）
  └─ 编辑 setSegments
```

现状是：

```text
乐观：segments + displayText → 正确（mention 颜色另计）
回显：常丢 segments，content 变 gatewayText → 占位泄漏 + synthesize 错落 + 易双气泡
编辑：若吃脏 content / 退化 segments → 输入框也出现 [文件:]/[技能:] 字面量；mention 常黑
```

---

## 3. 目标架构

### 3.0 分层示意

```text
┌─────────────────────────────────────────────────────────┐
│ 场景装配（本迭代只强制 Chat；Task 后置接线）              │
│  ChatInput / ChatMessage  │  TaskInstructionComposer…   │
└─────────────┬───────────────────────────┬───────────────┘
              │ 复用                        │ 跟进复用
              ▼                             ▼
┌─────────────────────────────────────────────────────────┐
│ 共享展示 / Composer 内核                                   │
│  UserComposerSegmentsContent（可抽离）                     │
│  DingTalkMentionTag / createMentionSpan / setSegments    │
│  buildComposerGatewayPayload / PersistedComposerSegment  │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ 共享会话底层（所有走 chat runtime 的场景自动受益）         │
│  optimistic-turn / user-message-merge / display-model    │
│  history-apply / runtime-v2 overlay 清乐观与回写         │
└─────────────────────────────────────────────────────────┘
```

### 3.1 单一渲染源

| 表面 | 数据 | 渲染 |
|------|------|------|
| 乐观气泡 | overlay 消息的 `_composerSegments` | 共享 `UserComposerSegmentsContent`（mention → `DingTalkMentionTag`） |
| 回显气泡 | history 消息上 **回写后的** `_composerSegments` | 同一组件 |
| 编辑输入 | 同一份 `PersistedComposerSegment[]` | `setSegments` → `createMentionSpan` / skill / workflow / file token |

规则：

- **有 `_composerSegments` 时**：气泡禁止再靠「整段正文正则猜 @」作为主路径（可保留无 segments 旧消息兜底）。  
- **配对成功后**：以 history 那条为唯一展示消息，并立即清 overlay 乐观。  
- **编辑**：优先带完整 segments；仅当旧消息无 segments 时走 synthesize / 纯文本兜底。  
- **底层无场景名**：merge / display / patch 只认 `RawMessage` + segments，不认「是不是 Chat 页」。

### 3.2 配对与清乐观

```text
发送 → 写 overlay.optimisticUserMessage（带 _composerSegments）
     → history 出现 user echo
     → findHistoryUserEcho（含 workflow / bake 文案感知）成功
     → 回写 _composerSegments / _skillMetas / _attachedFiles 到 echo
     → 清 overlay
     → 投影只留一条
```

`buildChatDisplayModel` 兜底：若 transcript/投影中 **已有** 与乐观配对的 user，即使 overlay 未清，也 **不再 append** 乐观。  
（该 display 模型已是 runtime 层能力；Task 若将来走同一 overlay，自动获得防双挂。）

---

## 4. 方案设计

### 4.1 阶段 A — 气泡 mention 样式（小改见效，可抽离）

**改动**

- `UserComposerSegmentsContent`：`case 'mention'` 改为 `DingTalkMentionTag`（`kind` 取 `seg.mention.type`）。  
- **优先**：将该组件（及 `synthesizeComposerSegments` 若紧耦合）抽到共享路径（例如 `src/components/input-composer/user-composer-segments.tsx`），`ChatMessage` 只引用；避免逻辑锁死在 Chat 页文件里。  
- 若本迭代来不及物理搬文件，至少 API/行为按「可被 Task 直接 import」编写，跟进 PR 再搬也可——但 **禁止** 在组件内依赖 Chat 路由/页面 state。

**验收**

- Chat 乐观气泡中 `@名` 立刻为蓝色，与输入框 token、最终正则染蓝视觉一致。  
- 组件可被非 Chat 模块引用（无 Chat 页副作用）。

### 4.2 阶段 B — 双气泡：配对增强 + 投影兜底

**B1. 配对增强（根因）** — [`user-message-merge.ts`](../src/stores/chat/user-message-merge.ts)

在 `isSameUserMessage` / `findHistoryUserEcho` 增加与 skill 对称的能力，至少满足：

1. **Workflow bake 感知**：将 candidate `content` 中「帮我执行 id 为：…的工作流 【…】」剥掉后再与乐观 `displayText` 比较。  
2. **阶段 6 占位感知**：配对前剥离 `[文件: …]` / `[技能: …]`（及既有 media attached / skill marker / 钉钉块），再比展示文案——否则单文件/混排几乎必然配对失败。  
3. **Segments / 附件时间窗**：乐观带 file/workflow/skill segments 或 `_attachedFiles` 时，在发送时间窗内允许「展示文案近似 + 附件证据」配对。  
4. **（可选增强）** Gateway 稳定把 `idempotencyKey` 回写为 user message `id`，让 `setTranscript` 的 id 匹配生效。

**B2. 清乐观时机** — [`runtime-v2-store.ts`](../src/stores/chat/runtime-v2-store.ts) / [`history-apply-loaded.ts`](../src/stores/chat/history-apply-loaded.ts)

- `setTranscript`：除 id 匹配外，复用 `findHistoryUserEcho`（或共享 helper）在 history 已有 echo 时清乐观，**不必等** runtime `completed`。  
- 保持现有 `clearOptimisticUserIfEchoed`；配对修好后应在首次 history apply 即生效。

**B3. 投影兜底** — [`display-model.ts`](../src/stores/chat/display-model.ts)

- append 乐观前：若 messages 中已存在与乐观配对的 user → 跳过 append。  
- 防止「清乐观失败」时仍双显。

**验收**

- 工作流 / **单文件** / 双文件+技能：思考与工具调用全程用户气泡 **始终一条**。  
- 结束后仍一条（样式正确依赖阶段 C，不能只清乐观）。

### 4.3 阶段 C — optimistic → history 结构化回写 + 展示去 bake

**改动** — 扩展现有 `patchSkillUserMessageFromOptimistic`（或新建 `patchComposerUserMessageFromOptimistic`）：

配对成功后，将乐观侧以下字段合并到 history echo（乐观优先，缺则保留 server）：

| 字段 | 说明 |
|------|------|
| `_composerSegments` | 混排权威；含 mention / skill / workflow / file（**保留 inline 顺序，禁止改成「附件置顶」**） |
| `_skillMetas` / `_skillMeta` | 多技能兼容 |
| `_attachedFiles` | 预览/文件名；可与 media 解析结果合并去重 |
| `content` | **必须**用乐观 `displayText`（或等价剥离结果），**禁止**残留 `[文件:]` / `[技能:]` / media attached / skill prompt / 钉钉收件人块 |

无乐观可配对的旧消息（兜底）：

- 在 `normalizeUserMessageForDisplay`（或专用 strip）中去掉阶段 6 占位，避免 synthesize 把占位当正文。  
- `synthesizeComposerSegments`：**不要**再把全部 file 无脑 prepend 到段首后与脏正文叠用；优先从正文位置还原，或仅在无任何顺序信息时降级。

**验收**

- 单文件终态：仅 chip +「将表中的数据生成一份 json」，**无** `[文件: …]`。  
- 复杂混排终态：与乐观相同的 inline 顺序；正文无 `[文件:]` / `[技能:]` 字面量。  
- 含 @ 的消息回显后编辑，输入框仍是蓝色 mention token，且无占位串。

### 4.4 阶段 D — 编辑回填加固（共享 edit-draft）

**改动**

- 继续强化已有共享钩子 [`use-input-composer-edit-draft.ts`](../src/components/input-composer/use-input-composer-edit-draft.ts)：气泡「编辑」优先传 `composerSegments`。  
- 确保回写后的 message 上始终有可用 segments（阶段 C）——Task 将来同一套 edit draft 即可。  
- **拒绝**把带 `[文件:]` / `[技能:]` 的脏 `text` 当 edit draft 正文；有 segments 时以 segments 为准。  
- 兜底（可选，旧消息）：若仅有正文 `@名` 且无 mention segment，编辑前可尝试从已知 `dingTalkMentions` 或展示名重建 mention segment；**无稳定 id 时**只做展示 token，发送前须用户重选或明确降级策略（本迭代可只修「有 segments」主路径）。

**验收**

- Chat：编辑回填后 `@名` 为蓝色 token；技能/文件为 chip；输入框 **不出现** `[文件:]` / `[技能:]` 字面量。  
- edit-draft 钩子仍保持场景无关（不依赖 Chat 页组件）。

### 4.5 Task 快速复用（跟进，非本迭代强制）

底层就绪后，Task 侧预期只需：

1. `TaskInstructionComposer`（或任务对话气泡）打开与 Chat 相同的 segments / `inlineAttachments` opt-in。  
2. 发送/落库带上 `composerSegments`（若任务走 chat runtime，乐观与 history 自动吃 B/C）。  
3. 气泡与编辑 import 共享 `UserComposerSegmentsContent` + `useInputComposerEditDraft`。  

**本迭代不做** Task UI 改造，但 Code Review 以「Task 能否只接线」为合并标准之一。

---

## 5. 实施顺序

| 顺序 | 阶段 | 内容 | 预估 |
|------|------|------|------|
| 1 | A | mention 样式 +（尽量）抽离共享渲染组件 | 小 |
| 2 | B | 配对增强 + 清乐观 + display 防双挂（runtime 底层） | 中 |
| 3 | C | 配对成功回写 `_composerSegments` 等（merge 底层） | 中 |
| 4 | D | 编辑回填确认 / 旧消息兜底（共享 edit-draft） | 小 |
| — | 跟进 | Task 装配接线（非本迭代） | 另开 |

建议：**A → B → C → D** 连续合入；A 可单独先行修黑字。  
验收以 **Chat** 为主；合入标准同时看 **底层是否可被 Task 直接复用**。

---

## 6. 风险与注意

| 风险 | 缓解 |
|------|------|
| 配对过宽误吞历史旧 user | 时间窗限制；优先 id；workflow 剥 exec 后再比；单测锁边界 |
| 回写 segments 与 gateway 原文不一致 | UI 只信 segments；`content` 仍用 display；发给模型的仍是已发出的 gatewayText（不改历史落库字符串也可） |
| 阶段 6 占位泄漏进气泡 | 配对后强制 displayText；`normalizeUserMessageForDisplay` 剥离 `[文件:]`/`[技能:]`；单测锁「气泡不含占位」 |
| synthesize 把文件置顶造成错落 | 有 `_composerSegments` 时禁止 synthesize；无则避免「附件 prepend + 脏正文」双通道 |
| 旧消息无 segments | 保留 synthesize + 正则染蓝兜底；展示前仍须 strip 占位 |
| 双清乐观竞态 | `setTranscript` 与 `clearOptimisticUserIfEchoed` 共用同一配对 helper，幂等清 null |
| 写成 Chat 专用、Task 难复用 | §1.4 / §3.0：能力沉底层；渲染抽共享组件；CR 检查无页面耦合 |
| Task 本迭代未接线 | 共享 merge / display 须保持「无 segments」旧路径可用，不强迫 Task 立刻升级 UI |

---

## 7. 验收清单

### 7.1 问题 1 / 3（双气泡）

- [x] 发送仅含「我的工作流」+ 短文案：思考/工具调用全程用户气泡 **不双份**（底层配对 + display 防双挂；待手工验收）
- [x] 发送 **仅含一个本地文件** + 短文案：全程不双份（单测覆盖配对）
- [x] 发送「文件 + 技能 + 工作流」混排：同上（底层已具备；待手工验收）
- [x] 整轮结束后仍单条
- [x] 日志：`[USER-QUESTION] server-echo` 能配对；overlay 乐观在首次 echo 后即为 null（不必等 completed）

### 7.2 问题 2（钉钉 @）

- [x] 乐观：`@名` 蓝色（`DingTalkMentionTag`）
- [x] 模型返回替换后：`@名` 蓝色，且为 `DingTalkMentionTag` / 同源样式（有 segments 时）
- [x] 编辑回填：输入框 `@名` 为 mention token（蓝底蓝字），可删 token、可再发（回写 segments 后 `setSegments`）

### 7.3 问题 3 / 4（占位泄漏与错落）

- [x] 单文件终态：只有文件 chip + 人话，**无** `[文件: …]` 明文（单测）
- [x] 双文件 + 技能 + @：终态 inline 顺序与乐观一致，正文 **无** `[文件:]` / `[技能:]`（回写 `_composerSegments`）
- [x] 编辑回填：输入框同样无占位明文，chip / mention token 齐全
- [x] 「清掉乐观后」不得以脏 history 文案作为最终 UI（回写 display + segments）

### 7.4 三处一致（总验收 · Chat）

对同一条「技能 + 正文 + @ +（可选文件/工作流）」消息：

- [x] 乐观 / 回显气泡 / 编辑输入框：**chip 种类、顺序、颜色一致**（底层；待手工回归）
- [x] 无 segments 的旧消息：不崩，行为不低于改前；若 content 含阶段 6 占位则展示前剥离

### 7.5 底层可复用（合入标准 · 面向 Task）

- [x] 配对 / 回写 / 清乐观 **无** Chat 页面或路由耦合
- [x] segments 气泡渲染组件可从非 `pages/Chat` 路径 import（`components/input-composer/user-composer-segments.tsx`）
- [x] `TaskInstructionComposer` 本迭代未改也能编译；无 segments 旧行为可用
- [x] 文档/注释标明 Task 跟进只需「装配 opt-in + 传 segments」，不必再改 merge

### 7.6 单测建议

- [x] `isSameUserMessage`：乐观 display vs 带 workflow exec 句的 history → 配对成功
- [x] `isSameUserMessage`：乐观 display vs 含 `[文件: …]` 的 gateway history → 配对成功
- [x] `buildChatDisplayModel`：投影已有 paired user 时不 append 乐观
- [x] 回写 patch：echo 的 `content` **不含** `[文件:]` / `[技能:]`，且带乐观 `_composerSegments`
- [x] `normalizeUserMessageForDisplay`（或专用 strip）：去掉阶段 6 占位
- [ ] `UserComposerSegmentsContent` / 渲染：mention 输出带 mention 样式 class（若抽测）

---

## 8. 关联代码索引

| 区域 | 路径 | 层级 |
|------|------|------|
| 气泡 segments 渲染 | [`src/components/input-composer/user-composer-segments.tsx`](../src/components/input-composer/user-composer-segments.tsx)（`ChatMessage` 引用） | 展示（共享） |
| Mention 蓝色标签 | [`src/components/dingtalk/DingTalkMentionTag.tsx`](../src/components/dingtalk/DingTalkMentionTag.tsx) | 共享 |
| 输入框 mention token | [`src/lib/dingtalk-mention-composer.ts`](../src/lib/dingtalk-mention-composer.ts) `createMentionSpan` | 共享内核 |
| 编辑回填 | [`src/components/input-composer/use-input-composer-edit-draft.ts`](../src/components/input-composer/use-input-composer-edit-draft.ts) | 共享 |
| 乐观插入 | [`src/stores/chat/optimistic-turn.ts`](../src/stores/chat/optimistic-turn.ts) | 会话底层 |
| 配对 / 去重 | [`src/stores/chat/user-message-merge.ts`](../src/stores/chat/user-message-merge.ts) | 会话底层 |
| history 应用 / 清乐观 | [`src/stores/chat/history-apply-loaded.ts`](../src/stores/chat/history-apply-loaded.ts) | 会话底层 |
| transcript + 清乐观 | [`src/stores/chat/runtime-v2-store.ts`](../src/stores/chat/runtime-v2-store.ts) | 会话底层 |
| 显示投影 | [`src/stores/chat/display-model.ts`](../src/stores/chat/display-model.ts) | 会话底层 |
| 展示文案归一 | [`src/lib/user-message-display.ts`](../src/lib/user-message-display.ts)（应 strip 阶段 6 占位） | 共享 |
| gateway bake | [`src/lib/composer-gateway-text.ts`](../src/lib/composer-gateway-text.ts) | 共享（模型侧；勿当 UI） |
| Task 装配（跟进） | [`src/components/task/TaskInstructionComposer.tsx`](../src/components/task/TaskInstructionComposer.tsx) | 场景（后置） |

---

## 9. 与前置文档关系

[`Composer内联混排-Segment模型与多SkillWorkflow透传.md`](./Composer内联混排-Segment模型与多SkillWorkflow透传.md) 解决的是 **输入/发送/气泡混排能力**（segments 从无到有；Chat 先落地、内核已对 Task 兼容），以及阶段 6 **模型位置语义**（`gatewayText` 原位 `[文件:]` / `[技能:]`）。  
本文解决的是 **发送后生命周期**：乐观与 history 如何收敛为一条，以及 UI **不得把阶段 6 占位当展示文案**——mention / 文件 / 技能 chip 在乐观 / 回显 / 编辑三处共用同一渲染源（底层通用、Chat 先验、Task 后接）。

建议开发时先按本文阶段 A–D 落地（以 Chat 验收），再回头勾选前置文档中的手工回归项；Task inline 跟进时直接复用本文底层，无需再开一套配对/回写逻辑。
