## Context

SClaw 通过 JSBridge（协议 `stoclaw-bridge/v1`）向 webview 内的 `*.sto.cn` H5 页面暴露宿主能力。当前能力集不含 AI 调用。

已核对的现状事实（决定了本设计的可行边界）：

| 事实 | 位置 |
|------|------|
| Main 拥有完整发送链路 | `electron/services/chat-send-service.ts` → `runMainChatSend` |
| Main 拥有 run 生命周期与规范事件 | `electron/services/chat-runtime-supervisor.ts`（`extends EventEmitter`，emit `CanonicalChatEvent`） |
| 已有「无 UI 的 agent 执行」先例 | `electron/scheduled-tasks/scheduled-task-executor.ts` |
| 发送落到 Main HTTP 路由 | `electron/api/routes/gateway.ts` → `dispatchChatSendRequest` |
| 侧边栏隐藏是**渲染进程显示层**的判定过滤 | `src/lib/sto-task-session.ts` → `isSidebarHiddenChatSessionKey` |
| `electron/` 下**无任何**隐藏逻辑、**无任何** `@/lib/` 导入 | grep 确认 |
| Guest preload 默认超时 30s | `shared/jsbridge-guest-preload-source.ts:54` |
| 会话类别判别符位于 `parts[2]`，`cron`／`scheduled-task`／`dingtalk`／`subagent`／`workflow` 均遵循 | `shared/session-type.ts` → `inferSessionCatalogMeta`；`electron/channels/session-key.ts` |
| catalog `session_type` 由 key **自动推断**，兜底为 `chat` | `shared/session-type.ts:102-106`；catalog 行创建时自动推断 |
| 普通聊天 key 为 `agent:{agentId}:session-{ts}-{uuid}` | `src/stores/chat/session-identity.ts:29-38` |
| Gateway 对 sessionKey **小写归一** | `electron/channels/session-key.ts:7-8` |
| `catalog_sessions.session_type` 无 CHECK 约束 | `electron/db/migrations/0008-session-types-and-channels.ts:8` |

关键约束：定时任务已在做「后台发起 agent 运行 → 监听 canonical 事件 → 终态处理」，Bridge AI 与其是**同构问题**，应复用同一模式而非新造。

## Goals / Non-Goals

**Goals:**

- H5 通过一次 `await` 拿到 AI 完整结果（P0），并可取消
- AI 调用不依赖聊天 UI 挂载、不依赖会话为当前可见会话
- webview 发起的会话**不出现在左侧对话列表**
- 准确性通过**配置**（应用级 prompt / 技能 / 上下文分层）达成，而非模型微调
- 能力默认关闭、需显式授权、有独立配额

**Non-Goals:**

- 为单个 webview 微调或训练模型
- Bridge 自动读写业务页面 DOM
- Bridge 代替业务系统做数据查重
- 修改 guest preload 的 30s 默认超时（影响面波及所有普通 invoke）
- 第一版即支持流式（列为 P1）

## Decisions

### D1 — AI 调用由 Main 进程独立完成，不经 Renderer 中继

Bridge handler 在 Main 内部调用 `runMainChatSend`，订阅 `ChatRuntimeSupervisor` 事件累积输出，等到终态后一次性返回 `BridgeResponse`。

**备选方案：Host Renderer 中继**——由渲染进程订阅 `subscribeCanonicalChatRuntimeProjection`，把增量回传 Main 再转发 guest。

**选择理由**：Renderer 那层只是**投影**，Main 才是事实源；经 Renderer 中继会把「聊天 store 已挂载并订阅」变成隐性前置条件，而这恰好与 D3「会话不可见」冲突——不可见的会话在 UI 层没有对应的订阅者。定时任务已验证 Main 侧模式可行。

**需要澄清的边界**：Renderer 仍在传输链路里（guest preload `sendToHost` → 宿主渲染进程 → `bridge:invoke` → Main），承载 webview 的渲染进程必然存活。D1 消除的是**对 chat UI 状态的依赖**，不是对渲染进程存活的依赖。

### D2 — 会话 key 必须遵循 SClaw 既有分段规范，不得由 Bridge 自创格式

**采用**：

```
agent:{agentId}:bridge-ai:{appId}:{conversationId}
```

全部片段小写；判别符位于 `parts[2]`，采用与 `parseDingTalkSessionKey` 一致的**分段解析**而非前缀正则。

**SClaw 的既有规范（已核对）**：区分会话类别的通行做法是 `agent:{agentId}:{category}:{...}`，由 `parts[2]` 充当类别判别符。`cron`、`scheduled-task`、`dingtalk`、`subagent`、`workflow` 全部遵循此模式，且集中在 `shared/session-type.ts` 的 `inferSessionCatalogMeta` 中被识别。

**备选方案 A：`session-bridge-ai-{appId}--{conversationId}`（本方案早期稿）**——已否决。它照抄的是内嵌浏览器的**例外写法**（`session-embed-app-` 前缀 + `--` 分隔符），把特例当作通例。三个具体问题：

1. `session-` 前缀在规范中已被占用——`createTemporaryAgentSessionKey` 生成的普通聊天 key 形如 `session-{ts}-{uuid}`，`isTemporaryAgentSessionKey` 以 `/^agent:[^:]+:session-\d+/` 识别；再叠加语义会让该命名空间含义混杂。
2. `--` 是 Bridge 自创的分隔符，需要额外的折叠规则来消除歧义（appId 自身含 `--` 时），而用 `:` 分段则天然无此问题。
3. 前缀正则判定与既有分段解析风格不一致，新增类别时无法被 `inferSessionCatalogMeta` 的分段分支自然覆盖。

**备选方案 B：复用 `agent:{agentId}:session-{ts}-{uuid}` 普通聊天格式**——已否决。key 上没有类别信息，无法据此实现侧边栏隐藏与 catalog 分类，等价于放弃隔离。

**选择理由**：`bridge-ai` 作为 `parts[2]` 判别符与现有五类保持一致，`appId` / `conversationId` 落在 `parts[3]` / `parts[4]`，与 `agent:{id}:dingtalk:{peerId}:{ts}:{nonce}` 的结构完全同构。

**硬约束——全片段小写**：

```7:8:electron/channels/session-key.ts
 * OpenClaw Gateway 会对 sessionKey 做小写归一；peerId 也必须小写，
 * 否则 delivery 监听的 key 与 gateway-event 对不上，钉钉侧收不到回程。
```

`appId` 可能含大写，若不归一会导致 delivery 监听的 key 与 gateway 事件对不上。构造时 MUST 对全部片段小写，`agentId` 复用既有 `normalizeAgentId`，`appId` / `conversationId` 按 dingtalk 同样方式将 `:` 替换为 `_`。

**契约模块位置**：新增 `shared/bridge-ai-session.ts`，导出构造、净化与分段判定。

- **备选：放 `src/lib/`**——不可行，Main 需要构造 key，而 `electron/` 下没有任何 `@/lib/` 导入。
- **备选：Main 与 Renderer 各自维护常量**——前缀会成为两端的隐式契约，一侧改动而另一侧未同步会导致会话静默泄漏到侧边栏，无编译错误。
- **选择理由**：与 `shared/session-type.ts`、`shared/session-agent-id.ts`、`shared/workflow-openclaw-session.ts` 一致——这些模块正是因主渲双端共用而置于 `shared/`。

### D3 — 不可见性必须同时覆盖侧边栏与 catalog 分类

Bridge AI 会话需要在**两处**登记，缺一即泄漏。

#### 其一：侧边栏隐藏（渲染进程显示层）

把分段判定函数注册进 `isSidebarHiddenChatSessionKey` 与 `isSidebarRecentChatSessionKey`。

**备选方案：在会话元数据上加 `hidden` 标志由 Main 下发**——语义更干净，但需改动会话注册表、catalog 落库与列表查询，影响面远大于本次；且与现有六类隐藏会话的实现方式不一致，会造成两套并行机制。

**选择理由**：复用既有机制，改动面最小且与现有约定一致。

**必须显式实现，不是顺带效果**——`electron/` 侧无隐藏概念，Main 建的会话会照常进入列表，**默认行为是「显示」**。

#### 其二：catalog 会话分类（`shared/session-type.ts`）

`inferSessionCatalogMeta` 是 catalog `session_type` 的**单一事实源**，主渲双端共用，且 catalog 行创建时**自动**按 key 推断类型。其兜底分支为 `everything else -> chat`。

这意味着：若不新增 `bridge-ai` 分支，Bridge AI 会话会被归类为**普通聊天会话**。而 `upsertEngineBinding` 在引擎绑定时会自动补 catalog 行，因此该错误分类是**必然发生**而非可能发生。

**采用**：`CatalogSessionType` 新增 `'bridge_ai'`，并在 `inferSessionCatalogMeta` 增加 `parts[2] === 'bridge-ai'` 分支，回填 `appId`。

**备选方案：复用既有 `'app'` 类型**——`'app'` 已表示「App Plaza 内嵌浏览器聊天会话」且同样携带 `appId`，复用可零枚举改动。但两者行为本质不同：`app` 是用户在应用抽屉里的**真实对话**，Bridge AI 是 H5 发起的**程序化一次性调用**。混为一类会让数据中心统计、清理策略（`ephemeral` 仅适用于 Bridge）与后续 UI 无法区分二者。

**选择理由**：分类正确性优先。代价可控——`catalog_sessions.session_type` 为 `TEXT NOT NULL DEFAULT 'chat'`，**无 CHECK 约束**（`electron/db/migrations/0008-session-types-and-channels.ts:8`），因此新增枚举值**不需要数据库迁移**，仅为类型层改动。需要做的是审计 `CatalogSessionType` 的穷举消费点（侧栏按 `session_type∈{cron,claude_task}` 过滤等），确认新增成员不改变既有分支结果。

### D4 — 先做非流式（P0），流式延后（P1）

**备选方案：流式优先**——体验更好，但需要同时打通事件通道语义、序号与乱序、断连补偿、取消时的半截输出处理。

**选择理由**：填报类主场景（校验／优化后回填）只需最终结果，一次 `await` 即可满足；非流式让 Main 侧「累积 delta → 等终态」的逻辑内聚在一处，先验证核心链路再扩展。流式复用同一累积器，增量成本可控。

### D5 — 超时设单一事实源，且不改 guest preload 默认值

| 层 | 取值 |
|----|------|
| Guest preload | 默认 30s（既有，**不改**）；SDK 发起 AI 调用时显式传入 |
| Bridge `timeoutMs` | 默认 120s，上限 180s |
| Supervisor `deadlineAt` | `now + timeoutMs`，与上一行同值 |

约束 `deadlineAt <= guest timeout`，超时时 Main 必须同步 abort。

**备选方案：把 guest preload 默认值改成 120s**——会让所有普通 invoke 的失败反馈延迟四倍，是不必要的连带影响。

**选择理由**：三层不一致会产生「页面已超时但运行仍在跑」的资源泄漏；由 SDK 在 AI 调用处显式传值，可在不动既有行为的前提下对齐。

### D6 — AI 能力默认关闭，Profile 为唯一实际门禁（两层结构）

`bridgePolicy.ai.enabled` 默认 `false`；未配置 profile 的应用调用 AI 能力一律拒绝。

**已核对的既有约束**：`DEFAULT_BY_TIER.internal = ALL_CAPABILITIES`（`shared/jsbridge/capabilities.ts:105-106`），因此把三个 AI 能力加入 `ALL_CAPABILITIES` 后，`internal` tier（appId 以 `__` 开头结尾，即 SClaw 自有内置应用）会**自动获得**这些能力。而 `catalog` tier 的清单是显式枚举，不加即不获得。

**采用**：保留 `internal: ALL_CAPABILITIES` 不变，由 AI Profile 的 `enabled` 充当**唯一实际门禁**，形成「能力层 + Profile 层」两层结构。配套两项要求：

1. 两层拒绝使用**可区分的错误码**（「能力未授予」与「AI 未启用」分开），便于定位。
2. `bridge.getCapabilities` 必须反映 AI 的**真实可用性**——Profile 未启用时不得把 AI 能力报为可用，否则 H5 会据此发起必然失败的调用。

**备选方案 A：把 `DEFAULT_BY_TIER.internal` 改为显式清单并排除 AI**——把意图写进代码最清晰，但会改变既有语义（今后新增任何能力都不再自动授予 internal），影响全部内置应用，需工程负责人评审。鉴于 internal 是 SClaw 自有应用、自动授予本就是既有设计意图，且 Profile 层已能兜住实际放行，此改动的收益不足以抵偿其影响面。

**备选方案 B：AI 能力不进 `ALL_CAPABILITIES`，单独维护能力集**——隔离最彻底，但会分裂 `isCapability()` 校验与整个能力体系，后续每处能力遍历都要考虑两套来源。

**选择理由**：真正的风险敞口在 `catalog`（三方绑定应用），而该层是显式清单、天然安全；`internal` 自动授予符合既有设计意图。把 Profile 作为唯一实际门禁既零改动既有代码，又保证「显式开启」的语义，代价仅是需补齐错误码区分与自省一致性这两处配套。

**`chat.cancel` 的风险等级例外**：`chat.complete` 与 `chat.invokeAgent` 定为 `critical` 且需 consent；但 `chat.cancel` 定为 `low` 且**不进** consent 清单。取消只能中止调用方自己发起的运行（跨应用取消由 spec 拒绝），属于降险操作；若因 consent 未授予而无法取消，反而会让应用无法中止已在消耗 token 的运行，与安全目标相反。

### D7 — 记忆默认不读不写，模式化开关

`memory.mode` 取 `none`（默认）/ `app` / `user-read`。

**备选方案：直接复用主链路记忆**——零改动，但会让业务 H5 的填报内容污染用户长期记忆，且跨应用串味。

**选择理由**：隔离优先。代价是需要改 `runMainChatSend` 这条**主链路共用**函数（见 Risk R1），故采用「新增可选入参」而非改默认行为。

### D8 — AI 调用使用独立配额，不复用通用 Bridge 限流

**备选方案：复用 `RATE_LIMIT_BY_TIER`**——无需新增配置，但普通 invoke 与一次完整 agent 运行的成本相差数个量级，同一套阈值必然要么过松（成本失控）要么过紧（正常调用被拒）。

**选择理由**：成本量级不同，必须分开计量。`quota` 列为上线门槛，不做「先放开后补」。

### D9 — 默认每次调用独立会话（ephemeral）

不传 `conversationId` 时每次生成新会话；传入则复用（`conversation` 模式）。

**备选方案：每应用一个长期会话**——天然支持多轮，但会让历史无限增长、跨页面串上下文，且触发 D10 的并发冲突。

**选择理由**：填报类场景是无状态的单次请求。ephemeral 同时规避了 `runIdempotentChatSend` 对同一 `sessionKey` 并发发送判为 replay 的问题（见 Risk R6）。代价是需在终态后清理，避免隐藏会话堆积。

### D10 — JSON 输出尽力解析，失败降级不抛错

`responseFormat: 'json'` 时 Main 尝试解析，成功给 `parsed`，失败给 `parseError` 并保留原始 `text`。

**备选方案：严格 schema 校验 + 失败即报错**——契约更硬，但模型输出本质不可保证，把不确定性变成硬失败会让 H5 完全拿不到可用信息。

**选择理由**：Bridge 不承诺模型正确性，只承诺**如实传达**。H5 必须自行校验，关键字段人工确认后再提交。

### UI 与主题

本设计**不新增页面级 UI**。唯一用户可见面是首次调用的 consent 授权弹窗，**复用现有 Bridge consent 组件**及其语义主题令牌，不引入新配色，暗色模式随既有组件继承。

若实施中确需新增可见控件，必须遵循 `docs/sto-design.md`：使用语义令牌表达前景／背景／边框，禁止 `bg-white` 一类仅亮色硬编码，并覆盖 hover／focus／disabled 的暗色表现。Phase 5「设置页查看/撤销 AI 授权」若落地，需按同一标准单独补暗色验收。

## Risks / Trade-offs

### 架构层

- **[R1 记忆写入侧无条件执行（读侧可规避）]** 已核对 `runMainChatSend` 实现，改动面比初估更小：**注入（读）侧**通过第三个位置参数 `prepareMemoryInjection` 回调完成，调用方传入直通实现即可不注入记忆，**无需改动主链路**；但**写入侧** `getMemoryTurnCoordinator(gatewayManager).begin(...)` 与 `agentMemoryContextService.prepare()` 在函数体内无条件执行，实现 `memory.mode: 'none'` 的「不写回」仍须改这条主会话与定时任务**共用**的函数。→ **Mitigation**：仅针对写入侧新增可选入参（如 `memory: { skipWrite: true }`），默认行为不变；变更须回归主会话与定时任务两条路径。

- **[R2 Skills 解析在渲染进程]** `resolveSkillPrompt` 位于 `src/lib/skill-plaza-resolve`，Main 无法直接调用。→ **Mitigation**：首版只支持应用级 `systemPrompt`（L0），Skills 拆为独立子任务并先做技术验证，不阻塞 P0。

- **[R3 页面上下文采集依赖渲染进程]** `sclaw-browser-embed-context-builder` 在 Renderer，Main 拿不到页面正文摘要。→ **Mitigation**：`injectPageContext` 延后；首版由 H5 自行把所需页面数据放进 `context`。

- **[R4 引擎能否接受新类别 sessionKey 未验证]** `agent:{agentId}:bridge-ai:{appId}:{conversationId}` 是否被 OpenClaw / Claude 适配器正常建会话，尚未实测；agentId 取非 `main` 时还需确认该 agent 目录存在。→ **Mitigation**：列为**动工前置 spike**，未通过不进入主体实现。

- **[R5 不可见性是「默认可见」模型，且有两处登记点]** 侧边栏隐藏依赖渲染进程判定、catalog 分类依赖 `inferSessionCatalogMeta`，两者默认行为都是「按普通聊天处理」。漏其一即泄漏：漏侧边栏则出现在左侧列表，漏 catalog 则被统计与查询当作普通会话。→ **Mitigation**：两处登记与核心实现同批交付并各自补单测；上线前逐项走查次要可见面（未读角标／`sessionLastActivity`、标题派生、历史与搜索落库）。

- **[R14 新增 `session_type` 枚举成员的穷举消费点]** `CatalogSessionType` 新增 `'bridge_ai'` 后，若某处 `switch` 或过滤逻辑未考虑该值，可能出现未预期分支（如被误纳入侧栏任务分组）。→ **Mitigation**：无需 DB 迁移（列无 CHECK 约束），但须审计全部 `CatalogSessionType` 消费点，确认既有分支结果不变；补单测覆盖新类型不进入侧栏任务分组。

- **[R15 会话工作目录与引擎路由]** Bridge AI 会话未绑定 workspace 时，`resolveSessionToolCwd` 会回落到 agent 默认目录；Claude 引擎的 `ensureClaudeRegistryEntry` 依赖该 cwd 解析成功。→ **Mitigation**：spike 阶段确认两种引擎下的 cwd 解析结果；首版明确 Bridge AI 会话使用 agent 默认目录，不做项目绑定。

- **[R6 幂等与并发约束]** `runIdempotentChatSend` + `supervisor.begin` 对同一 `sessionKey` 的并发发送判为 replay，多轮模式下快速连点会被拒。→ **Mitigation**：ephemeral 每次新 key；`conversation` 模式在 Bridge 侧排队并返回明确错误码。

### 产品与体验层

- **[R7 输出稳定性无法由 Bridge 保证]** 模型可能返回非法 JSON、缺字段、夹带 markdown。→ **Mitigation**：schema 约束写入 `systemPrompt`；Main 侧至多一次重试；契约层面明确 H5 必须校验，关键字段人工确认后再提交。

- **[R8 长耗时的交互成本]** AI 可能耗时 10～90 秒，`complete` 期间页面无进度感知。→ **Mitigation**：SDK 文档明确要求 H5 自建 loading／取消 UI；耗时长的场景建议改用 P1 流式。

- **[R9 超时链路三处对齐]** 任一层不一致会出现「页面已超时但运行仍在跑」。→ **Mitigation**：按 D5 统一口径，强制 `deadlineAt <= guest timeout`，超时同步 abort。

- **[R10 成本与配额]** 每次调用是一次完整 agent 运行，无配额时单应用可显著推高 token 成本。→ **Mitigation**：`quota` 为必填项且设保守默认值，列为上线门槛。

- **[R11 上下文长度]** 大表单可能超模型上限，Bridge 无法自动裁剪业务语义。→ **Mitigation**：Main 侧设 `context` 字节上限并返回明确错误码，由 H5 负责裁剪或摘要。

### 安全与合规

- **[R12 PII 进入模型 prompt]** 填报数据常含姓名、手机、地址。→ **Mitigation**：consent 文案明确告知；审计日志只记元数据（appId／用户／长度）不记原文；敏感应用由业务侧脱敏后再传。

- **[R13 授权粒度偏粗]** consent 为「能力级 + 应用级」，一次授权长期有效，用户无法按次感知。→ **Mitigation**：Phase 5 提供设置页查看／撤销；高风险应用可配置为每次确认。

## Migration Plan

本变更为**纯新增能力**，无数据迁移、无破坏性接口变更。

**分阶段与回滚**：

1. **前置 spike**（不落生产代码）：验证 R4 与「Main 侧能否拼出最终文本」。未通过则回到设计阶段。
2. **协议与配置**：类型与能力枚举扩展，`enabled` 默认 `false` ⇒ **零行为变更**，可独立合入。
3. **Main 核心 + 会话隐藏**：同批交付。回滚方式为下线三个 capability 注册，H5 侧调用回落为 `CAPABILITY_NOT_GRANTED`。
4. **生命周期与取消**、**SDK 与文档**、**可选增强**依次推进。

**功能开关**：AI Profile 的 `enabled: false` 即天然的灰度与熔断开关——按应用逐个放开，出问题可单应用关闭而不影响其他应用与主链路。

**通信链路回归**：本变更触及通信路径，实施后必须执行 `pnpm run comms:replay` 与 `pnpm run comms:compare`，并回归主会话与定时任务。

## Open Questions

1. **[阻断性]** 引擎是否接受 Bridge 自造的 `sessionKey`？（R4，spike 门禁）
2. **[阻断性]** `message.delta` payload 是否足以在 Main 侧拼出完整文本，还是必须回读 transcript？（影响 `bridge-ai-service` 主体结构）
3. Main 侧新增 `origin: 'bridge'` 后，记忆与定时任务模块是否存在对 `origin` 的穷举分支需同步？
4. 长时间 IPC invoke（>60s）在 Electron 下的稳定性如何？是否需要心跳保活？
5. 隐藏会话是否仍会触发未读角标、标题派生与历史／搜索落库？（R5 次要可见面，上线前须逐项确认）
6. `conversation` 模式下隐藏会话的清理策略与 TTL 由谁触发——Bridge session 销毁时，还是独立的定期清理？
