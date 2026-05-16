# Capability: `home-task-list-surface`（本 change 增量）

以下 **MODIFIED** 需求自 `openspec/changes/archive/2026-05-13-home-task-list/specs/home-task-list-surface/spec.md` **整段复制后修订**；**新增**需求列于后文。

---

## MODIFIED 需求

### Requirement: 任务列表稳定路由与任务键枚举

系统必须为每条归档原型任务提供稳定的路由前缀 `/tasks/:taskId`，其中 `taskId` 必须为以下字面量之一：`hq-reconciliation`、`abnormal-customers`、`outbound-cost`；未知 `taskId` 不得渲染详情正文，且必须将用户带回安全页面（例如应用首页）。系统 MUST 支持子项路由 `/tasks/:taskId/:entryId`，其中 `entryId` MUST 为与「点击瞬间本地日历日」对应的 `YYYY-MM-DD` 格式；非法 `entryId`（无法解析为日期或与注册表不一致的策略由实现与父 design 一致）时 MUST 将用户重定向至该 `taskId` 的安全路由（例如 `/tasks/:taskId` 或应用首页）。`/tasks/:taskId` MUST 作为该主任务总览或空态入口仍可访问。

#### Scenario: 合法任务键打开主任务或子项

- **WHEN** 用户导航至 `/tasks/hq-reconciliation`（或其它已定义任务键）
- **THEN** 应用必须渲染该任务允许的总览或引导表面，且不得为未知 `taskId` 伪造数据

#### Scenario: 合法子项路由打开聊天型详情

- **WHEN** 用户导航至 `/tasks/hq-reconciliation/2026-05-14` 且该 `entryId` 已为该 `taskId` 注册
- **THEN** 应用必须渲染该子项对应的详情表面，且主标题语义须与「该日期的材料」一致并来自 i18n

#### Scenario: 非法任务键被拒绝

- **WHEN** 用户导航至 `/tasks/unknown-id`
- **THEN** 应用不得展示伪造的报表或聊天数据正文
- **AND** 用户必须被重定向或引导回已定义的主应用首页路由

### Requirement: 首页概览卡与任务键对应并驱动子项创建

系统必须将首页每一张**已启用**的数据概览卡绑定到唯一 `taskId`（`hq-reconciliation`、`abnormal-customers`、`outbound-cost` 之一）；每张卡片 MUST 在 i18n（或等价集中配置）中绑定一句默认用户 prompt（**仅**在「新建当日子项」路径下由子项页代发，见下）。用户点击某张**已启用**卡片时，系统 MUST 按「点击瞬间本地日历日」计算 `entryId`（`YYYY-MM-DD`）：

- 若该 `(taskId, entryId)` **尚无**子项：MUST 创建并注册展示语义为「xxxx年XX月XX日的材料」的子项；随后 MUST `navigate` 至 `/tasks/<taskId>/<entryId>`，并携带由 `design.md` 定义的一次性导航状态，表明 **`entryBootstrap: 'created'`**（或等价）且包含该卡片用于自动发送的 **prompt 键或解析 token**（见 `task-subitem-chat-compose-surface`）。
- 若该 `(taskId, entryId)` **已存在**：MUST **不**再创建第二条；随后 MUST `navigate` 至同一 `/tasks/<taskId>/<entryId>`，并携带导航状态表明 **`entryBootstrap: 'reused'`**（或等价）且 **MUST** 要求子项页**仅**将聊天区滚动至底部，**不得**携带或触发默认 prompt 自动发送。

**已禁用**的卡片 MUST NOT 触发子项创建或导航至未开放任务子项。

#### Scenario: 从已启用卡片进入当日子项

- **WHEN** 用户点击已启用且绑定 `hq-reconciliation` 的首页卡片
- **THEN** 浏览器地址栏路径必须为 `/tasks/hq-reconciliation/<本地当日 YYYY-MM-DD>`（若当日已存在该子项则为同一 `entryId`）
- **AND** 侧栏该主任务下 MUST 出现或可导航至该子项条目

#### Scenario: 同日主任务下再次点击同一卡片（复用路径）

- **WHEN** 用户在同一本地日内第二次点击同一张已启用卡片，且当日子项已在注册表中存在
- **THEN** 系统 MUST NOT 创建第二条相同 `entryId` 的子项
- **AND** 导航目标 MUST 仍为同一 `/tasks/<taskId>/<entryId>`
- **AND** 导航状态 MUST 标识为复用路径（`entryBootstrap: 'reused'` 或等价）
- **AND** 系统 MUST NOT 再次注入该卡片默认 prompt 或触发自动 `sendMessage`（由 `task-subitem-chat-compose-surface` 约束）
- **AND** 子项页在加载完成后 MUST 将会话列表滚动至底部（或等价展示最新消息）

#### Scenario: 已启用卡片与子项互不串台

- **WHEN** 用户依次点击两张绑定不同 `taskId` 的已启用首页卡片
- **THEN** 每次导航后的 `taskId` 必须与卡片配置一致

### Requirement: 侧栏「任务列表」分组与动态子项导航

系统必须在侧栏主导航与工作台分组之间展示分组标题「任务列表」（通过 i18n 键），并列出与已定义 `taskId` 对应的主任务条目；每个主任务下 MUST 展示已由运行时注册表持久化的子项列表（按 design 定义的新旧顺序）。主任务行在展开态 MAY 保留设计占位红点；**子项行**在存在未读条件时 MUST 在该行**最右侧**展示小型圆点徽标，其色相 MUST 符合 `docs/sto-design.md` 中 **Danger / 提醒**语义，不得使用与 STO 体系冲突的随意主色。当前路由与某子项 `NavLink` 匹配时，该子项 MUST 使用浅灰表面背景与深色正文的选中样式（中性灰阶意图，不得使用 Brand-6 作为该行主背景）。

#### Scenario: 展开态展示分组、主项与子项

- **WHEN** 侧栏处于展开态且用户可见主导航
- **THEN** 用户必须在主导航下方看到「任务列表」标题及主任务条目
- **AND** 已注册子项 MUST 以可点击条目展示，展示标题 MUST 符合「日期 + 材料」的 i18n 模板语义

#### Scenario: 子项未读徽标

- **WHEN** 某子项存在未读条件（定义见 `task-subitem-chat-compose-surface`）且侧栏展开
- **THEN** 该子项行最右侧 MUST 显示未读圆点徽标
- **AND** 已读条件满足后该徽标 MUST 消失

### Requirement: 任务子项详情页信息结构（聊天为主）

任务子项详情表面 MUST 以**类聊天**主区域为核心：包含返回首页控件、由 i18n 提供的主标题（含日期与材料语义）、该子项绑定会话的消息时间线区域、以及与会话一致的输入与发送能力（工具行等行为须与既有 Chat 输入能力策略一致）。主区域 MUST NOT 将用户主要注意力置于与当前子项会话无关的报表表；若保留占位报表，则 MUST 置于次要位置或折叠，且不得违反「会话仅在子项聊天框」之产品语义（见 `task-subitem-chat-compose-surface`）。所有发送 MUST 经 host-api / 既有 Chat 存储路径；渲染进程 MUST NOT 在该页新增 `fetch('http://127.0.0.1:18789/...')` 调用。

#### Scenario: 子项首屏以聊天为主

- **WHEN** 用户打开合法子项路由 `/tasks/:taskId/:entryId`
- **THEN** 页面必须展示返回控件、主标题与聊天主区域
- **AND** 用户必须能够在该页完成查看助手输出与继续发送

#### Scenario: 发送行为不绕过 host-api 策略

- **WHEN** 用户在子项详情页通过输入区发送消息
- **THEN** 发送路径必须与既有 Chat 存储及 host-api 约束一致
- **AND** 渲染进程不得在该页新增直连 Gateway HTTP 的 `fetch`

### Requirement: 国际化与可维护性

所有用户可见的任务名称、子项标题、详情主标题、卡片绑定默认 prompt（**用于新建路径自动发送的文案**）、表头（若有）与占位正文必须可通过 `tasks`、`home` 或 `common` 命名空间下的 i18n 键在项目已支持的语种间切换；不得在组件内硬编码中文长句作为**唯一**文案源。

#### Scenario: 语言切换后任务与子项标题更新

- **WHEN** 用户在设置中切换显示语言后重新打开任务子项详情
- **THEN** 任务主标题与子项展示标题必须随语言资源切换而更新

#### Scenario: 默认 prompt 可本地化（新建路径）

- **WHEN** 用户切换语言后从首页点击某已启用卡片，且本次为**新建**当日子项
- **THEN** 自动发送所使用之用户消息文案 MUST 来自该语种下 i18n（或集中配置），不得仍为另一语种的硬编码残留

---

## 新增需求（本子项 change）

### Requirement: 子项注册表持久化与顺序

系统 MUST 将每个 `taskId` 下已创建的 `entryId` 列表在应用重启后仍可恢复（持久化机制与 design 一致）；同一 `taskId` 下 MUST NOT 出现两个相同 `entryId` 的重复注册。新创建的子项在侧栏中的顺序 MUST 符合 design 定义（例如新日靠前）。

#### Scenario: 重启后侧栏仍列出已创建子项

- **WHEN** 用户曾创建某 `entryId` 子项后关闭并重新打开应用
- **THEN** 侧栏该 `taskId` 下 MUST 仍展示该子项并可导航至同一路由
