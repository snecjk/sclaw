# Capability: `skills-plaza-use-composer`（本 change 新增）

## 新增需求

### Requirement: 技能字段职责分离（title 可见，defaultPrompt 隐藏注入）

系统 MUST 将技能 `title` 与 `defaultPrompt` 的职责严格分离：

- **`title`**：MUST 作为输入框 skill token 与消息气泡技能标签的唯一可见文案
- **`defaultPrompt`**：MUST 仅在用户点击发送时注入 Gateway RPC `text`；MUST NOT 出现在 URL 参数、输入框 tag 文案、消息气泡正文或 `RawMessage.content` 中
- **`slug`**：MUST 作为跨层关联键（导航 `?skill=`、composer dataset、发送时解析 `defaultPrompt`）

#### Scenario: 技能广场导航不传 defaultPrompt
- **WHEN** 用户点击已安装技能的「使用」按钮
- **THEN** 系统 MUST 导航至 `/?skill=<encodeURIComponent(slug)>`
- **AND** URL MUST NOT 包含 `q=<defaultPrompt>` 或任何 `defaultPrompt` 编码值
- **AND** `SkillCard` / `SkillDetailModal` MUST NOT 调用 `encodeURIComponent(skill.defaultPrompt)`

#### Scenario: 输入框 tag 仅展示 title
- **WHEN** Home 解析 `?skill=` 并在编辑器插入 skill token
- **THEN** token 可见文案 MUST 为 `skill.title`（fallback: `slug`）
- **AND** token 文案 MUST NOT 为 `defaultPrompt`
- **AND** 系统 MUST NOT 自动发送消息

#### Scenario: 发送时注入 defaultPrompt 到 Gateway
- **WHEN** 用户点击发送且 composer 中存在 skill token
- **THEN** 系统 MUST 按 `slug` 解析 `defaultPrompt`（fallback: `title`）
- **AND** 若用户无补充输入，Gateway RPC `text` MUST 为 `defaultPrompt`
- **AND** 若用户有补充输入，Gateway RPC `text` MUST 为 `` `${defaultPrompt}\n\n${userText}` ``
- **AND** `userText` MUST 仅指 composer `plainText`（不含 skill token 文本）

#### Scenario: 气泡不展示 defaultPrompt
- **WHEN** 用户发送带 skill token 的消息
- **THEN** 乐观用户消息 MUST 写入 `_skillMeta: { slug, title }`
- **AND** `RawMessage.content` MUST 仅保存用户补充输入文本（可为空）
- **AND** 气泡 MUST 渲染技能标签（`title`）+ 用户输入文本
- **AND** 气泡 MUST NOT 渲染 `defaultPrompt` 正文，即使用户未输入补充文本

### Requirement: 技能标签预填输入框（不自动发送）

已安装技能「使用」后，系统 MUST 在首页输入框预填技能标签 token，并等待用户手动点击发送。

#### Scenario: 点击使用后预填标签
- **WHEN** 用户从技能广场点击「使用」或详情弹窗点击「立即使用」（已安装）
- **THEN** 系统 MUST 创建新会话
- **AND** 系统 MUST 异步调用 `POST /api/skill-plaza/use`（不阻塞）
- **AND** 系统 MUST 导航至首页并插入 skill token
- **AND** 系统 MUST NOT 自动调用 `handleHubSend` 或等效发送逻辑

#### Scenario: Gateway 未就绪时仍可预填
- **WHEN** 用户点击「使用」时 Gateway 状态不是 `running`
- **THEN** 系统 MUST 仍完成导航与 skill token 预填
- **AND** 用户 MUST 在 Gateway 就绪后手动点击发送

#### Scenario: 仅有 skill 标签即可发送
- **WHEN** 输入框中存在 skill token 且用户未输入补充文本
- **THEN** 发送按钮 MUST 处于可点击状态
- **AND** 用户点击发送后 MUST 成功发出消息（Gateway 收到 `defaultPrompt`）

### Requirement: 用户消息气泡展示技能标签与用户文本

带 skill 上下文发送的用户消息 MUST 以「技能标签 + 用户输入」形式展示，样式对齐 `docs/sto-design.md` Brand-1 背景 / Brand-6 `#FF6F00` 文字与图标。

#### Scenario: 有用户补充输入
- **WHEN** 用户发送 skill token + 补充文本「帮我查一下上月数据」
- **THEN** 气泡 MUST 先展示橙色技能标签（文案为 `title`）
- **AND** 标签后 MUST 展示用户文本「帮我查一下上月数据」
- **AND** 气泡 MUST NOT 展示 `defaultPrompt`

#### Scenario: 无用户补充输入
- **WHEN** 用户仅发送 skill token，无补充文本
- **THEN** 气泡 MUST 仅展示橙色技能标签（文案为 `title`）
- **AND** 气泡 MUST NOT 展示 `defaultPrompt` 或任何额外正文

#### Scenario: 旧消息兼容
- **WHEN** 用户消息不含 `_skillMeta`（历史会话或 Gateway 回写）
- **THEN** 系统 MUST 按现有纯文本逻辑渲染
- **AND** MUST NOT 因缺少 `_skillMeta` 导致渲染异常

### Requirement: Composer skill token 序列化规则

`dingtalk-mention-composer` 对 skill token 的序列化 MUST 与 UI / 发送语义一致。

#### Scenario: skill token 不计入 plainText
- **WHEN** 编辑器包含 skill token 与用户输入
- **THEN** `serializeMentionEditor().plainText` MUST 仅包含用户输入
- **AND** `serializeMentionEditor().skill` MUST 包含 `{ slug, title }`

#### Scenario: 同一时刻最多一个 skill token
- **WHEN** 用户再次从技能广场选择另一技能
- **THEN** 系统 MUST 替换现有 skill token
- **AND** MUST 保留用户已输入的补充文本（若存在）

#### Scenario: skill token 与 workflow token 互斥
- **WHEN** 编辑器插入 skill token
- **THEN** 系统 MUST 清除 workflow token 及 `workflowId`
- **WHEN** 编辑器插入 workflow token
- **THEN** 系统 MUST 清除 skill token 及 `skill` snapshot 字段

### Requirement: 发送链路透传 skillMeta

从 Composer 到 `sendMessage` 的全链路 MUST 保留 skill 上下文，且分离 UI 展示字段与 Gateway 文本。

#### Scenario: dispatchChatSend 透传
- **WHEN** `ChatInput` 触发发送且 snapshot 含 `skill`
- **THEN** `dispatchChatSend` MUST 接收 `skillMeta: { slug, title }`
- **AND** `runtime-send-actions.sendMessage` MUST 据此构建 Gateway RPC `text`（含 `defaultPrompt`）
- **AND** 乐观 `RawMessage` MUST 写入 `_skillMeta` 且 `content` 为用户输入 only

#### Scenario: 消息队列保留 skill 上下文
- **WHEN** 发送时处于 `sending` 状态且消息被 queue
- **THEN** `QueuedMessage` MUST 携带 `skillMeta`
- **AND**  dequeue 发送时 MUST 保持与直接发送相同的 Gateway / 气泡语义
