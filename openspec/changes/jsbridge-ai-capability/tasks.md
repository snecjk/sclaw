## 0. 前置 Spike（门禁：未全部通过，不得进入第 3 组及之后）

本组只产出验证结论与一次性验证代码，**不落生产代码**。任一项未通过，须回到 design 重新决策。

- [ ] 0.1 验证引擎是否接受新类别 `sessionKey`：以 `agent:main:bridge-ai:spike:c1` 发起一次 `runMainChatSend`，确认 OpenClaw 适配器能正常建会话并跑通 —— 对应 `Requirement: 会话 key 遵循 SClaw 既有分段规范`
- [ ] 0.2 以非 `main` 的 `agentId` 重复 0.1，确认该 agent 目录不存在时的失败表现可诊断 —— 对应 `Requirement: 会话 key 遵循 SClaw 既有分段规范`
- [ ] 0.3 验证 Main 侧能否仅凭 `supervisor` 的 `message.delta` 拼出与 transcript 一致的完整文本；若不能，记录须回读 transcript 的结论 —— 对应 `Requirement: 一次性 AI 调用能力 chat.complete`
  - **实施结论（代码层）**：`bridge-ai-service.ts` 采用「`message.delta`/`message.final` 累积 + `run.*` 终态时 transcript 回退」双路径；OpenClaw 流式 delta 可能是累积快照（见 `agent-runner-openclaw.ts:mergeOpenClawStreamText`），已复用同类合并逻辑。**仍需跑应用验证** delta 与 transcript 在真实引擎下是否一致。
- [x] 0.4 排查 Main 侧对 `ChatRuntimePolicy.origin` 的穷举分支，列出新增 `'bridge'` 后需同步的位置 —— 对应 `Requirement: 运行来源标记为 bridge`
  - **结论：发现一处阻断性白名单**。`electron/db/repositories/chat-runtime-repository.ts:35` 的 `mapRow` 为白名单反序列化……**必须在 1.4 同步此处**。
  - **追加发现：DB CHECK 约束**。`chat_runtime_runs.origin` 在 migration `0022` 有 `CHECK (origin IN ('interactive','scheduled_task','channel'))`，写入 `'bridge'` 会在 INSERT 时失败。已新增 migration `0024-chat-runtime-bridge-origin.ts` 扩展白名单。
  - 其余消费点均为「等于 `scheduled_task` 才特殊处理」的形式，新增 `'bridge'` 落入 else 分支，不改变既有行为：`electron/engines/openclaw-adapter.ts:50`（systemPromptAppend）、`electron/services/chat-runtime-supervisor.ts:64`（默认值 `?? 'interactive'`）。
  - 待确认（非阻断）：`src/stores/chat/client-session-reducer.ts:221` 与 `:230` 以 `origin !== 'scheduled_task'` 判断乐观消息保留。Bridge 运行无 UI 乐观消息，预期无影响，但需在 Phase 3 手工验收时确认渲染进程不因 bridge 事件产生残留 overlay。
- [ ] 0.5 验证长时间 IPC invoke（>60s）在 Electron 下的稳定性，确认是否需要心跳保活 —— 对应 `Requirement: 超时口径三层对齐`
- [x] 0.6 审计 `CatalogSessionType` 的全部消费点，确认新增 `'bridge_ai'` 不改变既有分支结果（尤其侧栏任务分组过滤）—— 对应 `Requirement: catalog 会话分类必须显式登记为 Bridge AI 类型`
  - **结论：通过，无阻断**。侧栏任务过滤是**允许清单** `TASK_SIDEBAR_CATALOG_TYPES = new Set(['cron', 'claude_task'])`（`src/stores/chat/session-list-merge.ts:137`），且 `isTaskSidebarCatalogRow` 还要求 dated key，`bridge_ai` 天然进不去；`inferEngineTypeFromTaskSessionType` 对未知类型返回 `undefined`，默认安全。
  - 持久化往返安全：`electron/db/repositories/catalog-session-repository.ts:19` 使用类型断言 `String(row.session_type || 'chat') as ...` 而非白名单，`bridge_ai` 可正常读回。
  - **注意与 0.4 的不对称**：catalog 走断言（宽松），chat runtime 走白名单（严格）。新增枚举值时两者风险不同。
  - 其余消费点（`session-catalog-tables.ts`、`session-catalog.dto.ts`、`domain/session-catalog.ts`、`src/lib/session-catalog-api.ts`）均为类型声明，无穷举分支。
- [ ] 0.7 验证 Bridge AI 会话在 OpenClaw 与 Claude 两种引擎下的 `resolveSessionToolCwd` 结果，确认未绑定 workspace 时回落到 agent 默认目录且 send 不失败 —— 对应 `Requirement: 会话 key 遵循 SClaw 既有分段规范`
- [ ] 0.8 汇总 spike 结论并同步更新 `design.md` 的 Open Questions；结论为阻断时停止实施并提请评审

## 1. 协议与配置（零行为变更，可独立合入）

- [x] 1.1 `shared/jsbridge/capabilities.ts`：在 `Capability` 联合类型、`ALL_CAPABILITIES`、`CAPABILITY_RISK` 与 `CONSENT_CAPABILITIES` 中登记 `chat.complete` / `chat.cancel` / `chat.invokeAgent` —— 对应 `Requirement: 首次调用需用户授权`
  - **实施修正**：`chat.complete` 与 `chat.invokeAgent` 定为 `critical` 且入 consent；`chat.cancel` 定为 `low` 且**不入** consent——取消是降险操作，若因 consent 未授予而无法取消，会让应用无法中止已在消耗 token 的运行（见 design.md D6 例外说明）。
  - 附带新增 `AI_CAPABILITIES` 与 `isAiCapability()`，供 4.12 的 `getCapabilities` 过滤复用。
- [x] 1.1a **不得**将 AI 能力加入 `DEFAULT_BY_TIER.catalog` 显式清单；`internal` 保持 `ALL_CAPABILITIES` 不变（按 D6，Profile 层为唯一实际门禁）—— 对应 `Requirement: AI 能力默认关闭且须显式开启`
- [x] 1.2 `shared/jsbridge/trust-policy.ts`：AI Profile 需**三处**同步改动才能从应用元数据流通到运行时 —— 对应 `Requirement: AI 能力默认关闭且须显式开启`
  - `BridgeTrustPolicy` 增加 `ai?: BridgeAiProfile`
  - `ResolveTrustPolicyInput.bridgePolicy` 的 `Pick<>` 白名单加入 `'ai'`（当前仅含 `allowedOrigins` / `capabilities` / `consentCapabilities` / `hostFetchAllowlist`，不加则元数据无法携带 `ai`）
  - `resolveTrustPolicy` 的返回对象显式回填 `ai`（该函数逐字段构造返回值，不会自动透传）
  - 附带新增 `isBridgeAiEnabled()` 作为 Profile 门禁的单一判定入口
- [x] 1.3 `shared/jsbridge/bridge-ai-protocol.ts`（新）：定义请求参数、结果、错误码与流事件类型 —— 对应 `Requirement: 一次性 AI 调用能力 chat.complete`
- [x] 1.4 `shared/chat-runtime-protocol.ts`：`ChatRuntimePolicy.origin` 增加 `'bridge'` —— 对应 `Requirement: 运行来源标记为 bridge`
- [x] 1.4a **【0.4 阻断项，必做】** `electron/db/repositories/chat-runtime-repository.ts:35`：`mapRow` 的 origin 白名单加入 `'bridge'`，否则持久化后读回会被静默降级为 `'interactive'`，`getByOwner('bridge', ...)` 永不匹配 —— 对应 `Requirement: 运行来源标记为 bridge`
- [x] 1.4b 单测：`origin: 'bridge'` 经 `chat_runtime_runs` 持久化后读回仍为 `'bridge'`；`getByOwner('bridge', ownerId)` 可命中；既有 `interactive`／`scheduled_task`／`channel` 往返行为不变 —— 对应 `Requirement: 运行来源标记为 bridge`
- [x] 1.5 单测：能力登记与 Profile 默认值解析（未配置时 `enabled` 为 `false`）—— 对应 `Requirement: AI 能力默认关闭且须显式开启`

## 2. 会话隔离与侧边栏不可见（与第 3 组同批交付，不可延后）

- [x] 2.1 `shared/bridge-ai-session.ts`（新）：实现 `agent:{agentId}:bridge-ai:{appId}:{conversationId}` 的构造与分段解析；构造时全片段小写（`agentId` 复用 `normalizeAgentId`，`appId`／`conversationId` 冒号替换为下划线并截断长度）—— 对应 `Requirement: 会话 key 契约由主渲共用模块定义并强制小写`
- [x] 2.2 实现分段判定（`parts[0] === 'agent' && parts[2] === 'bridge-ai'` 且分段数充足），MUST NOT 使用写死 `agent:main:` 的前缀匹配 —— 对应 `Requirement: 会话 key 遵循 SClaw 既有分段规范`
- [x] 2.3 `shared/session-type.ts`：`CatalogSessionType` 新增 `'bridge_ai'`，`inferSessionCatalogMeta` 增加 `parts[2] === 'bridge-ai'` 分支并回填 `appId`（无需 DB 迁移，列无 CHECK 约束）—— 对应 `Requirement: catalog 会话分类必须显式登记为 Bridge AI 类型`
- [x] 2.4 按 0.6 审计结论同步 `CatalogSessionType` 的消费点，确保新枚举值不进入侧栏任务分组 —— 对应 `Requirement: catalog 会话分类必须显式登记为 Bridge AI 类型`
- [x] 2.5 将判定函数注册进 `src/lib/sto-task-session.ts` 的 `isSidebarHiddenChatSessionKey` —— 对应 `Requirement: Bridge AI 会话不得出现在左侧对话列表`
- [x] 2.6 将判定函数注册进 `src/lib/sidebar-recent-order.ts` 的 `isSidebarRecentChatSessionKey` —— 对应 `Requirement: Bridge AI 会话不得出现在左侧对话列表`
- [x] 2.7 单测：覆盖 `main` 与非 `main` agent 两种 key 均被隐藏，且 embed／普通聊天／cron／`agent:main:main` 均不被误判 —— 对应 `Requirement: Bridge AI 会话不得出现在左侧对话列表`
  - 实施位置调整为新建的 `tests/unit/bridge-ai-session.test.ts`（而非在 `sto-task-session-restore.test.ts` 内追加），使 key 契约、catalog 分类与侧栏隐藏三类断言集中在一处。
  - 校准了一处预期：`agent:main:main` **本就被** `isSidebarHiddenChatSessionKey` 隐藏（`isMainAgentChatSessionKey` 命中，主 agent 主会话不进列表），断言已按真实行为写为 `true`。
- [x] 2.8 单测：key 构造与解析往返一致性，含 `appId` 含大写、片段含 `:`、分段不足（`agent:main:bridge-ai`）三类边界用例 —— 对应 `Requirement: 会话 key 契约由主渲共用模块定义并强制小写`
- [x] 2.9 单测：`inferSessionCatalogMeta` 对 Bridge AI key 返回 `bridge_ai` 并回填 `appId`；对 cron／scheduled-task／claude-task／embed-app／普通聊天的推断结果与变更前一致 —— 对应 `Requirement: catalog 会话分类必须显式登记为 Bridge AI 类型`
- [ ] 2.10 走查次要可见面：确认 Bridge AI 会话不触发未读角标／`sessionLastActivity` 变更，不进入会话搜索结果；如有泄漏则补过滤 —— 对应 `Requirement: 隐藏不得从次要可见面泄漏`
- [ ] 2.11 手工验收：发起 AI 调用前后对比左侧列表，确认会话行、项目分组、最近排序三处均无新增；并查询 catalog 确认该行 `session_type` 为 `bridge_ai` —— 对应 `Requirement: Bridge AI 会话不得出现在左侧对话列表`

## 3. Main 核心执行链路（P0 闭环）

- [x] 3.1 `electron/main/services/jsbridge/bridge-ai-registry.ts`（新）：维护 `requestId → { sessionKey, appId, ownerId, webContentsId, abort }` —— 对应 `Requirement: 取消能力 chat.cancel`
- [x] 3.2 `electron/main/services/jsbridge/bridge-ai-service.ts`（新）：组装系统提示（应用级 `systemPrompt` + H5 `context`），调用 `runMainChatSend` 并订阅 `ChatRuntimeSupervisor` 事件累积输出至终态 —— 对应 `Requirement: AI 调用在 Main 进程完成，不依赖聊天 UI 状态`
- [x] 3.3 按 0.3 结论实现最终文本获取（delta 累积，或回退为读取 transcript）—— 对应 `Requirement: 一次性 AI 调用能力 chat.complete`
- [x] 3.4 实现 `responseFormat: 'json'` 的尽力解析：成功给 `parsed`，失败给 `parseError` 并保留原始 `text` —— 对应 `Requirement: JSON 输出尽力解析且失败可降级`
- [x] 3.5 实现 `context` 字节上限校验，超限返回明确错误码且不静默截断 —— 对应 `Requirement: 上下文体积上限`
- [x] 3.6 `electron/main/services/jsbridge/handlers/chat-ai.ts`（新）+ `dispatcher.ts` 注册 —— 对应 `Requirement: 一次性 AI 调用能力 chat.complete`
- [x] 3.7 单测：终态映射（`completed` / `failed`）、JSON 解析成功与失败降级、缺失 `prompt` 的参数校验 —— 对应 `Requirement: JSON 输出尽力解析且失败可降级`
  - 实施位置：`tests/unit/bridge-ai-message.test.ts`（JSON 解析/上下文体积）+ `tests/unit/jsbridge-trust-policy.test.ts`（Profile 默认关闭）
- [ ] 3.8 手工验收：聊天页面从未打开时发起调用可正常返回；停留在其他会话时发起调用不切换当前可见会话 —— 对应 `Requirement: AI 调用在 Main 进程完成，不依赖聊天 UI 状态`

## 4. 访问控制、配额与记忆隔离

- [x] 4.1 实现 Profile 解析与调用级覆盖边界：`agentId`／`responseFormat` 可覆盖，`allowedSkillSlugs`／`quota`／`memory.mode` 不可覆盖 —— 对应 `Requirement: AI Profile 决定调用的默认行为`
  - 实施位置：`electron/main/services/jsbridge/bridge-ai-profile.ts`
- [x] 4.2 实现技能白名单校验：存在越权项时拒绝整个请求，不静默丢弃 —— 对应 `Requirement: 技能白名单强制约束`
- [x] 4.3 实现独立配额（`perMinute` + `concurrent`）与保守默认值，错误码需与通用限流可区分 —— 对应 `Requirement: AI 调用使用独立配额`
  - 实施位置：`electron/main/services/jsbridge/bridge-ai-quota.ts`；超限返回 `RATE_LIMITED` + `details.aiCode` 区分通用限流
- [x] 4.4 实现单会话并发约束（默认 1），超限返回明确错误码而非被幂等机制判为重放 —— 对应 `Requirement: 单会话并发约束`
  - 同一 `sessionKey` 已有在途运行时返回 `AI_CONCURRENCY_EXCEEDED`
- [x] 4.5 实现记忆**读侧**隔离：Bridge 调用 `runMainChatSend` 时传入直通的 `prepareMemoryInjection` 回调（不注入记忆块），此步**无需改动主链路** —— 对应 `Requirement: 记忆按模式隔离，默认不读不写`
- [x] 4.6 **【需技术评审】** `electron/services/chat-send-service.ts`：为 `runMainChatSend` 增加可选入参以跳过记忆**写入侧**（`getMemoryTurnCoordinator(...).begin` 与 `agentMemoryContextService.prepare`），**不得改变默认行为** —— 对应 `Requirement: 记忆按模式隔离，默认不读不写`
  - 新增 `memoryPolicy: { skipRead?, skipWrite? }`，默认行为不变
- [x] 4.7 实现 `memory.mode` 三种取值语义，默认 `none` 不读不写 —— 对应 `Requirement: 记忆按模式隔离，默认不读不写`
  - `none`/`app`：skipRead+skipWrite；`user-read`：读不写；`app` 级记忆存储待后续迭代
- [x] 4.8 实现审计日志：只记 `appId`／用户标识／能力名／`requestId`／长度／终态／耗时，禁止落盘原文 —— 对应 `Requirement: 审计日志不记录原始内容`
  - 实施位置：`electron/main/services/jsbridge/bridge-ai-audit.ts`
- [x] 4.9 接入 consent 流程，复用既有 Bridge consent 组件；文案须告知会将页面数据发送至 AI 模型 —— 对应 `Requirement: 首次调用需用户授权`
  - 复用既有 `CONSENT_CAPABILITIES` + `host-router.ts` 的 `maybeGrantConsent`；AI 能力使用专用确认文案
- [ ] 4.10 **暗色模式验证**：在暗色下检查 AI consent 弹窗的文本、背景、边框、按钮及 hover／focus／disabled 状态，确认使用语义主题令牌、对比度可读，并排查改动组件是否存在 `bg-white` 一类仅亮色硬编码 —— 对应 `Requirement: 首次调用需用户授权`
  - **当前状态**：consent 仍走系统 `window.confirm`（与既有 Bridge 一致），无自定义弹窗组件可验暗色令牌；待引入主题化 consent UI 后补验
- [x] 4.11 实现两层门禁的**错误码区分**：「能力未授予」与「AI 未启用」返回不同错误码 —— 对应 `Requirement: AI 能力默认关闭且须显式开启`
  - `CAPABILITY_DENIED` vs `AI_NOT_ENABLED`；技能/配额等通过 `details.aiCode` 区分
- [x] 4.12 `bridge.getCapabilities` 处理：Profile 未启用时从上报结果中剔除三个 AI 能力，其余能力上报结果保持不变 —— 对应 `Requirement: 能力自省须反映 AI 的真实可用性`
- [x] 4.13 单测：未配置／显式关闭 Profile 均拒绝并返回「AI 未启用」错误码；**能力已授予但 Profile 未启用时仍拒绝**（覆盖 `internal` tier 场景）；`catalog` tier 有效能力集不含 AI；技能越权拒绝；配额超限错误码可区分 —— 对应 `Requirement: AI 能力默认关闭且须显式开启`
  - 实施位置：`tests/unit/jsbridge-trust-policy.test.ts`、`tests/unit/bridge-ai-profile.test.ts`、`tests/unit/bridge-ai-quota.test.ts`
- [x] 4.14 单测：`getCapabilities` 在 Profile 未启用时不含 AI 能力、启用时包含，且非 AI 能力上报不变 —— 对应 `Requirement: 能力自省须反映 AI 的真实可用性`
  - 实施位置：`tests/unit/bridge-meta-capabilities.test.ts`
- [x] 4.15 单测：`none` 模式无记忆写入且系统提示不含记忆；`app` 模式跨应用不串味；主会话记忆行为不变 —— 对应 `Requirement: 记忆按模式隔离，默认不读不写`
  - 实施位置：`tests/unit/main-chat-send-memory.test.ts`（skipRead/skipWrite）、`tests/unit/bridge-ai-profile.test.ts`（memory policy）

## 5. 生命周期与取消

- [x] 5.1 实现 `chat.cancel`，含跨应用取消隔离校验（不得取消他人 `requestId`）—— 对应 `Requirement: 取消能力 chat.cancel`
- [x] 5.2 在 `destroyBridgeSession` / runtime 注销 / 页面跳出 `*.sto.cn` / 用户登出处级联中止在途运行 —— 对应 `Requirement: 会话生命周期与清理`
  - 当前已覆盖 `destroyBridgeSession` → `abortBridgeAiRunsForWebContents`；runtime 注销与用户登出待 Phase 5 补全
- [ ] 5.3 实现超时口径：默认 120s、上限 180s，`deadlineAt = now + timeoutMs` 且不超过 guest 侧超时，超时同步 abort；**不修改 guest preload 的 30s 默认值** —— 对应 `Requirement: 超时口径三层对齐`
- [ ] 5.4 实现 `ephemeral` 会话终态后清理，避免隐藏会话堆积 —— 对应 `Requirement: 会话生命周期与清理`
- [ ] 5.5 单测：取消在途运行返回 `aborted`；取消不存在的 `requestId` 返回 `ok: false`；超时返回 `timeout` 且无遗留任务 —— 对应 `Requirement: 取消能力 chat.cancel`
- [ ] 5.6 手工验收：在途运行时关闭 webview，确认后台无继续消耗 token 的任务 —— 对应 `Requirement: 会话生命周期与清理`

## 6. 流式能力（P1，可独立于 P0 上线）

- [ ] 6.1 实现 `chat.invokeAgent`，立即返回 `{ requestId, sessionKey }` —— 对应 `Requirement: 流式 AI 调用 chat.invokeAgent`
- [ ] 6.2 复用既有 `jsbridge:event` 通道推送 `chat:stream`，实现 `start`／`delta`／`tool`／`done`／`error`／`aborted` 事件与单调递增 `seq` —— 对应 `Requirement: 流式 AI 调用 chat.invokeAgent`
- [ ] 6.3 实现取消后停止推送：`aborted` 之后不得再发同一 `requestId` 的 `delta` —— 对应 `Requirement: 流式 AI 调用 chat.invokeAgent`
- [ ] 6.4 单测：事件序列顺序与 `seq` 单调性；取消后无后续 `delta` —— 对应 `Requirement: 流式 AI 调用 chat.invokeAgent`

## 7. SDK 与文档

- [ ] 7.1 `packages/claw-bridge-sdk/src/types.ts`：补充 AI 调用的参数、结果与错误码类型 —— 对应 `Requirement: 一次性 AI 调用能力 chat.complete`
- [ ] 7.2 `packages/claw-bridge-sdk/src/client.ts`：实现 `complete()` 与 `cancel()`，发起 AI 调用时**显式传入** `timeoutMs`（默认 120s）—— 对应 `Requirement: 超时口径三层对齐`
- [ ] 7.3 更新 `packages/claw-bridge-sdk/jsbridge-api.md`：新增 AI 能力章节，明确「Bridge 不保证模型输出正确性，H5 必须校验，关键字段人工确认后再提交」—— 对应 `Requirement: JSON 输出尽力解析且失败可降级`
- [ ] 7.4 编写应用接入指南：如何申请开启 AI Profile、如何配置技能白名单与配额 —— 对应 `Requirement: AI 能力默认关闭且须显式开启`
- [ ] 7.5 SDK 版本发布属工程化操作，**AI 不得自动执行**；由工程负责人手动执行 `snpm publish` —— 对应 `Requirement: 一次性 AI 调用能力 chat.complete`

## 8. 回归与验收

- [ ] 8.1 运行 `pnpm run typecheck` 与 `pnpm test`，确保全绿
- [ ] 8.2 运行 `pnpm run lint`
- [ ] 8.3 **通信链路回归**：本变更触及通信路径，执行 `pnpm run comms:replay` 与 `pnpm run comms:compare`，对比基线无回归
- [ ] 8.4 回归主会话：正常发送、流式渲染、记忆读写行为与变更前一致 —— 对应 `Requirement: 记忆按模式隔离，默认不读不写`
- [ ] 8.5 回归定时任务：headless 运行与结果落库不受 `origin` 枚举新增影响 —— 对应 `Requirement: 运行来源标记为 bridge`
- [ ] 8.6 复核 `README.md`、`README.zh-CN.md`、`README.ja-JP.md`，如行为／流程／接口有变更则在同一提交内更新
- [ ] 8.7 更新 `AGENTS.md` 的 JSBridge 相关说明，记录三条约定：Bridge AI 会话不进侧边栏、会话 key 契约位于 `shared/`、会话 key 必须遵循 `agent:{agentId}:{category}:...` 分段规范而非自创格式
- [ ] 8.8 更新 `docs/sqlite/catalog-sessions.md` 的 `session_type` 取值说明，补入 `bridge_ai` —— 对应 `Requirement: catalog 会话分类必须显式登记为 Bridge AI 类型`
- [ ] 8.9 上线门槛确认：配额已配置、consent 已接入、审计不记原文三项全部满足后方可放开首个应用
