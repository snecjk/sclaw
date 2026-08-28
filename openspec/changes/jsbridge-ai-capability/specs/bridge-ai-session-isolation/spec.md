## ADDED Requirements

### Requirement: 会话 key 遵循 SClaw 既有分段规范

Bridge AI 会话 key 格式 SHALL 为 `agent:{agentId}:bridge-ai:{appId}:{conversationId}`，即以 `parts[2]` 作为类别判别符，与既有 `cron`、`scheduled-task`、`dingtalk`、`subagent`、`workflow` 类别保持同构。

系统 MUST NOT 自创分隔符或前缀形态。具体而言：MUST NOT 使用 `session-` 前缀承载类别语义（该命名空间已被普通聊天 key `session-{ts}-{uuid}` 占用），MUST NOT 引入 `--` 之类的自定义片段分隔符。

识别 MUST 采用分段解析（校验 `parts[0] === 'agent'` 且 `parts[2] === 'bridge-ai'`），MUST NOT 采用写死 `agent:main:` 的前缀匹配，以支持任意 `agentId`。

#### Scenario: 识别非 main agent 的会话 key
- **WHEN** 传入 `agent:research:bridge-ai:demo:c1`
- **THEN** 识别函数返回 true，且能解析出 `agentId` 为 `research`、`appId` 为 `demo`、`conversationId` 为 `c1`

#### Scenario: 不误判其他类别会话
- **WHEN** 依次传入 `agent:main:session-embed-app-demo`、`agent:main:session-1234-abcd`、`agent:main:cron:job1`、`agent:main:main`
- **THEN** Bridge AI 识别函数对以上全部返回 false

#### Scenario: 分段不足时不误判
- **WHEN** 传入 `agent:main:bridge-ai`（缺少 appId 与 conversationId）
- **THEN** 识别函数 MUST NOT 将其视为合法 Bridge AI 会话 key

### Requirement: 会话 key 契约由主渲共用模块定义并强制小写

key 的构造、片段净化与识别 MUST 由 Main 与渲染进程**共用的单一模块**提供，且该模块 MUST 位于 `shared/`。Main 与渲染进程 MUST NOT 各自维护重复的常量或判定逻辑。

由于 OpenClaw Gateway 对 sessionKey 做小写归一，构造函数 MUST 将全部片段转为小写，否则 delivery 监听的 key 会与 gateway 事件不匹配。

片段净化规则：`agentId` MUST 复用既有 `normalizeAgentId`；`appId` 与 `conversationId` 中的冒号 MUST 被替换为下划线以保持分段结构，长度 MUST 被截断。

#### Scenario: appId 含大写字母
- **WHEN** 以 `appId` 为 `MyApp` 构造会话 key
- **THEN** 生成的 key 中该片段为全小写 `myapp`，确保与 Gateway 归一后的 key 一致

#### Scenario: 片段含冒号
- **WHEN** 以含冒号的 `appId` 或 `conversationId` 构造会话 key
- **THEN** 冒号被替换为下划线，`agent:{agentId}:bridge-ai:{appId}:{conversationId}` 的五段结构保持完整且可被正确解析

#### Scenario: 构造与解析往返一致
- **WHEN** 用净化后的 `agentId`、`appId`、`conversationId` 构造 key 再解析
- **THEN** 解析结果与净化后的输入完全一致

### Requirement: catalog 会话分类必须显式登记为 Bridge AI 类型

`CatalogSessionType` SHALL 新增 `'bridge_ai'` 取值，且 `inferSessionCatalogMeta` MUST 增加对 `parts[2] === 'bridge-ai'` 的分支并回填 `appId`。

Bridge AI 会话 MUST NOT 被归类为 `'chat'`（`inferSessionCatalogMeta` 的兜底类型），也 MUST NOT 被归类为 `'app'`（内嵌浏览器真实对话）。

新增枚举成员 MUST NOT 改变既有 `session_type` 消费点的行为，尤其 MUST NOT 使 Bridge AI 会话进入侧栏任务分组。

#### Scenario: 推断出 bridge_ai 类型
- **WHEN** 对 `agent:main:bridge-ai:demo:c1` 调用 `inferSessionCatalogMeta`
- **THEN** 返回 `sessionType: 'bridge_ai'`，`appId` 为 `demo`，`taskId` 为 `null`

#### Scenario: 引擎绑定自动补 catalog 行时分类正确
- **WHEN** Bridge AI 运行触发引擎绑定并自动创建 catalog 行
- **THEN** 该行的 `session_type` 为 `bridge_ai`，MUST NOT 为 `chat`

#### Scenario: 不进入侧栏任务分组
- **WHEN** 侧栏按 `session_type` 过滤任务会话分组
- **THEN** `bridge_ai` 会话 MUST NOT 出现在任务分组中

#### Scenario: 既有类型推断不受影响
- **WHEN** 对 cron、scheduled-task、claude-task、embed-app 与普通聊天 key 调用 `inferSessionCatalogMeta`
- **THEN** 其返回的 `sessionType` 与本变更前完全一致

### Requirement: Bridge AI 会话不得出现在左侧对话列表

由 webview 发起的 AI 会话 MUST NOT 出现在左侧对话列表的任何位置，包括会话行、项目分组与最近会话排序。

系统 MUST 将 Bridge AI 会话识别函数注册进侧边栏隐藏判定 `isSidebarHiddenChatSessionKey` 与最近会话集合判定 `isSidebarRecentChatSessionKey`。

该行为 MUST 有单元测试覆盖，MUST NOT 依赖实现者记忆。

#### Scenario: AI 调用后侧边栏不新增会话行
- **WHEN** H5 发起 `chat.complete` 并正常完成
- **THEN** 左侧对话列表 MUST NOT 出现该会话，会话总数与调用前一致

#### Scenario: 不进入最近会话排序
- **WHEN** Bridge AI 会话产生活动
- **THEN** 该会话 MUST NOT 进入最近会话顺序，MUST NOT 挤占既有会话位置

#### Scenario: 不出现在项目分组
- **WHEN** 侧边栏渲染项目分组列表
- **THEN** Bridge AI 会话 MUST NOT 作为任何分组的成员出现

#### Scenario: 非 main agent 的 AI 会话同样不可见
- **WHEN** 应用 Profile 指定了非 `main` 的 `agentId` 并发起 AI 调用
- **THEN** 该会话同样 MUST NOT 出现在左侧对话列表

#### Scenario: 既有会话可见性不受影响
- **WHEN** 用户拥有普通聊天、cron、内嵌浏览器等各类既有会话
- **THEN** 这些会话的可见与隐藏行为 MUST 与本变更前完全一致

### Requirement: 隐藏不得从次要可见面泄漏

除会话列表外，Bridge AI 会话 MUST NOT 通过未读角标、会话活跃度或全局搜索结果向用户暴露。

#### Scenario: 不产生未读角标
- **WHEN** Bridge AI 运行产出消息
- **THEN** 系统 MUST NOT 因此增加任何未读计数或角标提示

#### Scenario: 不出现在会话搜索结果
- **WHEN** 用户在会话搜索中输入与 AI 调用内容匹配的关键词
- **THEN** 搜索结果 MUST NOT 返回 Bridge AI 会话

### Requirement: 运行来源标记为 bridge

系统 SHALL 在 `ChatRuntimePolicy.origin` 中新增 `'bridge'` 取值，Bridge AI 发起的运行 MUST 以该值标记，并 MUST 设置可关联单次请求的 `ownerId`。

#### Scenario: 运行携带 bridge 来源
- **WHEN** Bridge 发起一次 AI 运行
- **THEN** 该运行的 `runtimePolicy.origin` 为 `'bridge'`，`ownerId` 可唯一定位到发起该运行的 `appId` 与 `requestId`

#### Scenario: 既有来源行为不受影响
- **WHEN** 主会话或定时任务发起运行
- **THEN** 其 `origin` 取值与既有行为保持不变，不因新增枚举值而改变分支结果

### Requirement: 记忆按模式隔离，默认不读不写

系统 SHALL 支持 `memory.mode` 取值 `none`、`app`、`user-read`，默认 MUST 为 `none`。

`none` 模式下，本次运行 MUST NOT 读取用户记忆，也 MUST NOT 写回任何记忆。

#### Scenario: 默认模式不写回记忆
- **WHEN** 应用未配置 `memory.mode` 并完成一次 AI 调用
- **THEN** 用户记忆存储 MUST NOT 新增任何条目，本次运行的系统提示中 MUST NOT 含用户记忆内容

#### Scenario: 只读模式不产生写入
- **WHEN** 应用配置 `memory.mode: 'user-read'` 并完成一次 AI 调用
- **THEN** 运行可读取用户偏好，但 MUST NOT 写回任何记忆

#### Scenario: 应用级记忆不跨应用串味
- **WHEN** 应用 A 配置 `memory.mode: 'app'` 并写入记忆，随后应用 B 发起 AI 调用
- **THEN** 应用 B 的运行 MUST NOT 读取到应用 A 的记忆内容

#### Scenario: 主链路记忆行为不受影响
- **WHEN** 用户在主会话正常对话
- **THEN** 主会话的记忆读写行为 MUST 与本变更前保持一致

### Requirement: 会话生命周期与清理

系统 SHALL 在 bridge session 销毁、webview 关闭、页面跳出 `*.sto.cn` 或用户登出时，中止该 guest 的全部在途 AI 运行。

`ephemeral` 会话模式下，系统 SHALL 在运行到达终态后清理其会话数据，避免隐藏会话无限堆积。

#### Scenario: webview 关闭时中止在途运行
- **WHEN** 存在在途 AI 运行时用户关闭该 webview
- **THEN** 系统中止该运行，MUST NOT 遗留后台任务继续消耗 token

#### Scenario: 页面跳出受信域名
- **WHEN** 页面导航到 `*.sto.cn` 之外的地址
- **THEN** 该 guest 的全部在途 AI 运行被中止

#### Scenario: 一次性会话在终态后清理
- **WHEN** `ephemeral` 模式的 AI 运行到达终态
- **THEN** 该会话数据被清理，重复调用 MUST NOT 导致隐藏会话数量持续增长
