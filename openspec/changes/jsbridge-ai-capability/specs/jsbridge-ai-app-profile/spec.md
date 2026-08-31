## ADDED Requirements

### Requirement: AI 能力默认关闭且须显式开启

系统 SHALL 在应用元数据的 `bridgePolicy` 下支持 `ai` 配置节（AI Profile），其 `enabled` 字段默认值 MUST 为 `false`。

AI 调用 SHALL 受**两层独立门禁**约束：能力授予（capability）与 AI Profile 启用状态。无论能力层是否授予，未配置或未启用 AI Profile 的应用调用任何 AI 能力，系统 MUST 拒绝——即 Profile 是实际的唯一放行依据。

`catalog` trust tier 的默认能力清单 MUST NOT 包含 AI 能力，即三方绑定应用不因绑定而获得 AI 能力。

两层拒绝 MUST 使用**可区分的错误码**：能力未授予与 AI 未启用需返回不同错误码，以便调用方定位问题。

#### Scenario: 未配置 AI Profile 的应用发起调用
- **WHEN** 某应用没有 `bridgePolicy.ai` 配置，其页面调用 `chat.complete`
- **THEN** Bridge 拒绝请求并返回「AI 未启用」错误码，且 MUST NOT 发起任何 AI 运行

#### Scenario: 显式关闭 AI 的应用发起调用
- **WHEN** 应用配置了 `ai.enabled: false`，其页面调用 `chat.complete`
- **THEN** Bridge 拒绝请求并返回「AI 未启用」错误码

#### Scenario: 能力已授予但 Profile 未启用
- **WHEN** 某应用在能力层已被授予 `chat.complete`（例如 `internal` trust tier 默认获得全部能力），但其 AI Profile 未启用
- **THEN** Bridge MUST 拒绝该调用并返回「AI 未启用」错误码，MUST NOT 因能力已授予而放行

#### Scenario: 三方绑定应用不因绑定获得 AI 能力
- **WHEN** 一个 `catalog` trust tier 的应用未在 `bridgePolicy.capabilities` 中显式声明 AI 能力
- **THEN** 该应用的有效能力集 MUST NOT 包含任何 AI 能力

### Requirement: 能力自省须反映 AI 的真实可用性

`bridge.getCapabilities` 返回的能力集 SHALL 反映 AI 能力的**实际可调用状态**。当应用的 AI Profile 未启用时，返回结果 MUST NOT 将 AI 能力呈现为可用，避免 H5 据此误判后发起必然失败的调用。

#### Scenario: Profile 未启用时不上报 AI 能力
- **WHEN** 某应用在能力层已被授予 AI 能力但其 AI Profile 未启用，页面调用 `bridge.getCapabilities`
- **THEN** 返回的能力集中 MUST NOT 包含 `chat.complete`、`chat.cancel` 或 `chat.invokeAgent`

#### Scenario: Profile 启用时正常上报
- **WHEN** 某应用的 AI Profile 已启用且能力层已授予
- **THEN** 返回的能力集包含已授予的 AI 能力

#### Scenario: 非 AI 能力的自省结果不变
- **WHEN** 页面调用 `bridge.getCapabilities`
- **THEN** 除 AI 能力外，其余能力的上报结果 MUST 与本变更前一致

### Requirement: AI Profile 决定调用的默认行为

AI Profile SHALL 支持配置目标 `agentId`、应用级 `systemPrompt`、默认注入技能 `skills`、可追加技能白名单 `allowedSkillSlugs`、默认 `responseFormat`、是否注入页面上下文 `injectPageContext`、记忆模式 `memory.mode`、会话模式 `session.mode` 与配额 `quota`。

调用级参数与 Profile 冲突时，系统 SHALL 以「Profile 定义边界、调用级在边界内覆盖」为准：`agentId` 与 `responseFormat` 可被调用级覆盖，`allowedSkillSlugs`、`quota`、`memory.mode` MUST NOT 被调用级覆盖。

#### Scenario: 应用级 systemPrompt 被注入
- **WHEN** 应用配置了 `systemPrompt` 且页面发起 AI 调用
- **THEN** 该 prompt MUST 作为系统提示注入本次运行，位于 H5 传入的 `context` 之前

#### Scenario: 调用级覆盖 agent
- **WHEN** 调用方传入 `agentId` 且该 agent 可用
- **THEN** 本次运行使用调用级指定的 agent，而非 Profile 默认值

#### Scenario: 调用方尝试覆盖配额
- **WHEN** 调用方在请求参数中试图提升配额或修改记忆模式
- **THEN** 系统 MUST 忽略该意图并沿用 Profile 配置

### Requirement: 技能白名单强制约束

系统 SHALL 校验调用级 `skillSlugs`，其中每一项 MUST 属于该应用 Profile 的 `allowedSkillSlugs`。存在越权项时，系统 MUST 拒绝整个请求，MUST NOT 静默丢弃越权项后继续执行。

#### Scenario: 请求包含白名单外技能
- **WHEN** 调用方传入的 `skillSlugs` 含有不在 `allowedSkillSlugs` 中的条目
- **THEN** Bridge 拒绝整个请求并返回技能越权错误码，且 MUST NOT 发起 AI 运行

#### Scenario: 请求技能全部在白名单内
- **WHEN** 调用方传入的 `skillSlugs` 均在白名单内
- **THEN** 这些技能与 Profile 默认技能合并后注入本次运行

### Requirement: AI 调用使用独立配额

系统 SHALL 为 AI 调用实施独立于通用 Bridge 限流（`RATE_LIMIT_BY_TIER`）的配额，至少包含每分钟调用数 `perMinute` 与并发数 `concurrent`。

`quota` MUST 为启用 AI 的应用的必填项，且系统 MUST 提供保守默认值。

#### Scenario: 超出每分钟配额
- **WHEN** 某应用一分钟内的 AI 调用次数超过 `perMinute`
- **THEN** 后续请求被拒绝并返回配额超限错误码，且该错误 MUST 与通用限流错误可区分

#### Scenario: 启用 AI 但未配置配额
- **WHEN** 应用配置 `ai.enabled: true` 但未提供 `quota`
- **THEN** 系统 MUST 应用保守默认配额，MUST NOT 视为不限量

### Requirement: 首次调用需用户授权

AI 相关能力 SHALL 被登记为高风险能力并纳入用户 consent 流程。系统 MUST 在应用首次调用 AI 能力时请求用户显式确认，用户拒绝时 MUST 返回未授权错误码。

consent 弹窗 SHALL 复用既有 Bridge consent 组件与 `docs/sto-design.md` 的语义主题令牌，文案 MUST 告知该操作会将页面数据发送至 AI 模型。

#### Scenario: 首次调用触发授权确认
- **WHEN** 某应用首次调用 `chat.complete`
- **THEN** 系统展示 consent 确认，用户同意后请求继续执行，用户拒绝则返回未授权错误码

#### Scenario: consent 弹窗的暗色模式表现
- **WHEN** 应用处于暗色模式并触发 AI consent 弹窗
- **THEN** 弹窗的文本、背景、边框与按钮 MUST 使用语义主题令牌渲染，正文与按钮文字保持可读对比度，且 hover、focus 与 disabled 状态在暗色下均可辨识；MUST NOT 出现 `bg-white` 一类仅亮色硬编码

### Requirement: 审计日志不记录原始内容

系统 SHALL 为每次 AI 调用记录审计日志，字段 MUST 限于元数据（如 `appId`、用户标识、能力名、`requestId`、prompt 与 context 的长度、终态、耗时）。

审计日志 MUST NOT 记录 prompt、context 或模型输出的原文。

#### Scenario: 调用产生审计记录
- **WHEN** 一次 AI 调用完成
- **THEN** 系统写入含上述元数据的审计记录，且记录中不含任何业务原文

#### Scenario: 含个人信息的调用
- **WHEN** H5 传入的 `context` 含姓名、手机号等个人信息
- **THEN** 审计日志仅记录其字节长度，MUST NOT 落盘原始字段值
