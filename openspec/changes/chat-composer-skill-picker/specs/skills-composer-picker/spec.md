## ADDED Requirements

### Requirement: 星号触发已安装技能列表

对话输入框 MUST 支持使用 `*` 字符触发已安装技能选择浮层。工作流 Picker MUST 继续独占 `/` 字符；MUST NOT 将 `/` 用于技能列表。

#### Scenario: 输入星号打开技能浮层
- **WHEN** 用户在输入框内按下 `*` 且当前不存在 skill token
- **THEN** 系统 MUST 在输入框上方展示技能选择浮层
- **AND** 浮层 MUST 展示标题「技能」
- **AND** 浮层 MUST NOT 自动发送消息

#### Scenario: 工作流斜杠行为不变
- **WHEN** 用户在输入框内按下 `/`
- **THEN** 系统 MUST 仍打开 WorkflowPicker
- **AND** MUST NOT 打开技能浮层

#### Scenario: 已有 skill token 时不重复触发
- **WHEN** 输入框已存在 skill token
- **THEN** 按下 `*` MUST NOT 再次打开技能浮层（或 MUST 先替换 token，行为与 design 一致且仅一种）

### Requirement: 技能列表最多可见五行并内部滚动

技能浮层的列表区域 MUST 最多同时可见 **5** 行技能条目；超出部分 MUST 在浮层列表容器内垂直滚动，MUST NOT 撑高整页。

#### Scenario: 已安装技能超过五条
- **WHEN** 用户打开技能浮层且已安装技能数量大于 5
- **THEN** 浮层 MUST 初始可见 5 行
- **AND** 用户 MUST 能在浮层列表区域内滚动查看其余技能

#### Scenario: 已安装技能不超过五条
- **WHEN** 已安装技能数量小于等于 5
- **THEN** 浮层 MUST 展示全部条目
- **AND** MUST NOT 出现无意义的滚动条

### Requirement: 左下角工具 icon 打开技能浮层与搜索

输入框左下角工具栏 MUST 提供 wrench（工具）icon。点击后 MUST 打开与 `*` 触发共用的技能浮层，且浮层顶部 MUST 展示搜索框（placeholder「搜索技能」）。

#### Scenario: 点击工具 icon
- **WHEN** 用户点击输入框左下角 wrench 工具 icon
- **THEN** 系统 MUST toggle 技能选择浮层
- **AND** 浮层 MUST 展示搜索输入框
- **AND** 列表 MUST 仍遵守最多可见 5 行 + 内部滚动规则

#### Scenario: 工具 icon 搜索过滤
- **WHEN** 用户在搜索框输入关键词
- **THEN** 列表 MUST 实时过滤已安装技能
- **AND** 匹配字段 MUST 包含技能 `title` 与 `description`

### Requirement: 技能名称与描述模糊匹配及橙色高亮

技能浮层 MUST 支持按用户输入的关键词过滤已安装技能。匹配 MUST 对技能的 **title** 与 **description** 进行不区分大小写的子串匹配。命中片段 MUST 以 **Brand-6 `#FF6F00`** 高亮展示（对齐 `docs/sto-design.md`）。

#### Scenario: 星号触发后继续输入筛选
- **WHEN** 用户通过 `*` 打开浮层并在输入框继续输入「异常」（即 editor 内联 query 为「异常」）
- **THEN** 浮层列表 MUST 仅展示 title 或 description 包含「异常」的已安装技能
- **AND** 列表项 title / description 中的「异常」片段 MUST 以 Brand-6 橙色高亮

#### Scenario: 工具 icon 模式搜索高亮
- **WHEN** 用户通过 wrench icon 打开浮层并在搜索框输入「异常」
- **THEN** 过滤与高亮规则 MUST 与星号内联模式一致

#### Scenario: 无匹配结果
- **WHEN** 过滤后无技能匹配
- **THEN** 浮层 MUST 展示空态文案（如「无匹配技能」）
- **AND** MUST NOT 崩溃或展示未安装技能

### Requirement: 数据源为已安装技能

技能浮层 MUST 仅展示当前用户**已安装**的技能列表。数据源 MUST 为 `useSkillPlazaStore.mySkills` 或等价的「我的技能 / 已安装」 API 结果。

#### Scenario: 打开浮层时加载我的技能
- **WHEN** 技能浮层首次打开且本地 `mySkills` 为空
- **THEN** 系统 MUST 触发已安装技能列表拉取
- **AND** 加载中 MUST 展示 loading 态

#### Scenario: 不展示未安装技能
- **WHEN** 某技能仅在技能广场存在但未安装
- **THEN** 该技能 MUST NOT 出现在 composer 技能浮层中

### Requirement: 选中技能插入 composer skill token

用户从浮层选择技能后，系统 MUST 调用既有 composer skill token 插入逻辑（`insertSkillSpan(slug, title)`），并 MUST 遵循 `skills-plaza-use-composer` 的字段职责：`title` 可见、`defaultPrompt` 不可见、不自动发送。

#### Scenario: 选中后插入 tag
- **WHEN** 用户点击某技能条目
- **THEN** 系统 MUST 在编辑器首位插入 skill token（文案为 `title`）
- **AND** MUST 关闭技能浮层
- **AND** MUST NOT 调用发送

#### Scenario: 星号内联 query 不进入用户正文
- **WHEN** 用户通过 `*` + 内联关键词选择技能
- **THEN** 系统 MUST 从 editor 移除 `*` 及其后的 filter 文本
- **AND** 最终 `plainText` MUST NOT 包含 `*` 或 filter 关键词（除非用户另行输入）

#### Scenario: 与 workflow token 互斥
- **WHEN** 用户从浮层选择技能且 editor 存在 workflow token
- **THEN** 系统 MUST 清除 workflow token 后再插入 skill token

#### Scenario: 替换已有 skill token
- **WHEN** editor 已存在 skill token 且用户再次选择另一技能
- **THEN** 系统 MUST 替换为新的 skill token
- **AND** MUST 保留用户已输入的补充 plainText（若存在）

### Requirement: 技能浮层视觉与无障碍

技能浮层视觉 MUST 对齐 `docs/sto-design.md`：列表项 wrench 图标、title 为主文字色、description 为 muted 辅色；匹配高亮 MUST 使用 Brand-6。浮层 MUST 提供合理的 `aria-label` / 按钮类型以便键盘与读屏访问（具体键位导航可为 follow-up）。

#### Scenario: 列表项结构
- **WHEN** 技能浮层展示某技能
- **THEN** 每行 MUST 包含 wrench 图标、技能 title、单行 truncate 的 description（若有）
- **AND** 行 hover 态 MUST 使用与 WorkflowPicker 一致的 neutral hover 背景

#### Scenario: 匹配高亮颜色
- **WHEN** 过滤关键词命中技能 title 或 description
- **THEN** 命中子串 MUST 使用 Brand-6 `#FF6F00` 前景色高亮
- **AND** MUST NOT 使用未在 `docs/sto-design.md` 定义的随意色值作为唯一强调色
