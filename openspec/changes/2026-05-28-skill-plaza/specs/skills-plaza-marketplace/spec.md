# Capability: `skills-plaza-marketplace`（本 change 新增）

## 新增需求

### Requirement: 技能广场页面替换现有 Skills 路由

系统 MUST 将 `/skills` 路由指向技能广场页面组件，该页面 MUST 完整替代现有 Skills 页面的核心功能（技能浏览、安装、卸载），并以市场门店形态呈现。侧栏中 Skills 导航入口 MUST 保持不变（路径、图标、标签均不变）。

#### Scenario: 用户导航至技能广场
- **WHEN** 用户点击侧栏"技能"导航项或直接访问 `/skills`
- **THEN** 系统 MUST 渲染技能广场页面
- **AND** 页面 MUST 显示标题"技能广场"与副标题"管理你可以安装的技能，快速查看与使用"

#### Scenario: 侧栏导航入口不变
- **WHEN** 技能广场页面替换上线后
- **THEN** 侧栏中"技能"的导航路径 MUST 仍为 `/skills`
- **AND** 用户在侧栏看到的图标和标签 MUST NOT 变化

### Requirement: 双 Tab 切换（技能广场 / 我的技能）

页面顶部 MUST 展示两个 Tab 按钮："技能广场"（默认激活）和"我的技能"。Tab 切换 MUST 更新展示的技能列表和可用功能。

#### Scenario: 默认展示技能广场 Tab
- **WHEN** 用户首次进入技能广场页面
- **THEN** "技能广场" Tab MUST 处于激活态（`aria-selected="true"`）
- **AND** "我的技能" Tab MUST 处于非激活态
- **AND** 页面 MUST 展示全量技能列表（官方 + 已安装 + 自建）

#### Scenario: 切换到我的技能 Tab
- **WHEN** 用户点击"我的技能" Tab
- **THEN** 页面 MUST 仅展示用户已安装的技能（含已安装 + 自建）
- **AND** 视图切换控件（宫格 / 条目）MUST 可见
- **AND** 分类导航中"全部"以外的分类计数 MUST 仅统计已安装技能

### Requirement: 分类导航

页面 MUST 在工具栏下方展示水平分类导航，包含以下分类：全部、经营管理、财务管理、异常监控、外部市场、办公。分类列表数据 MUST 由后端 API 提供。分类切换 MUST 过滤当前列表。

#### Scenario: 分类导航渲染
- **WHEN** 技能广场页面加载完成
- **THEN** 分类导航 MUST 渲染后端返回的全部分类项
- **AND** "全部"分类 MUST 默认激活（`aria-selected="true"`）
- **AND** 每个分类项右侧 MUST 显示当前筛选条件下的技能数量

#### Scenario: 切换分类过滤
- **WHEN** 用户点击某个分类（如"财务管理"）
- **THEN** 技能列表 MUST 仅展示 `category` 匹配该分类的技能
- **AND** 该分类项 MUST 成为激活态
- **AND** 其他分类计数 MUST 更新为对应分类下的匹配数量

#### Scenario: 分类数据来自后端
- **WHEN** 前端调用 `GET /api/skill-plaza/categories`
- **THEN** 后端 MUST 返回完整分类列表，每项包含 `id`、`label`（i18n 友好名称）、`slug`
- **AND** 前端 MUST NOT 硬编码分类列表

### Requirement: 搜索功能

页面 MUST 提供搜索输入框，支持按技能名称或描述进行模糊匹配。搜索 MUST 与分类、Tab 筛选联合生效。

#### Scenario: 输入搜索关键词
- **WHEN** 用户在搜索框输入关键词"对账"
- **THEN** 技能列表 MUST 仅展示名称或描述中包含"对账"的技能
- **AND** 匹配 MUST 不区分大小写

#### Scenario: 搜索与分类联合
- **WHEN** 用户已选择"财务管理"分类并输入搜索词
- **THEN** 结果 MUST 同时满足分类和搜索条件

#### Scenario: 搜索无结果
- **WHEN** 搜索 + 分类组合无匹配结果
- **THEN** 页面 MUST 展示"暂无可用技能"空态文案

### Requirement: 排序功能（热门 / 最近）

页面 MUST 提供排序下拉菜单，支持"热门"（按安装数降序）和"最近"（按最近更新 / 安装时间降序）两种排序方式。默认 MUST 为"热门"。

#### Scenario: 默认排序
- **WHEN** 技能广场页面加载完成
- **THEN** 排序 MUST 默认为"热门"
- **AND** 技能列表 MUST 按安装数降序排列

#### Scenario: 切换排序
- **WHEN** 用户打开排序下拉并选择"最近"
- **THEN** 排序触发按钮 MUST 更新显示"最近"
- **AND** 技能列表 MUST 按最近更新时间降序重新排列
- **AND** 下拉菜单 MUST 自动关闭

### Requirement: 视图切换（宫格 / 条目）

页面 MUST 提供视图切换控件（宫格视图 / 条目视图），默认 MUST 为宫格视图。视图切换 MUST 仅在"我的技能" Tab 下可见。

#### Scenario: 默认宫格视图
- **WHEN** 用户进入"我的技能" Tab
- **THEN** 视图切换控件 MUST 可见
- **AND** 宫格视图按钮 MUST 处于激活态（`aria-pressed="true"`）
- **AND** 技能列表 MUST 以 3 列卡片网格渲染（≤900px 时 2 列，≤600px 时 1 列）

#### Scenario: 切换到条目视图
- **WHEN** 用户点击条目视图按钮
- **THEN** 技能列表 MUST 以单列条目形式渲染
- **AND** 每个条目 MUST 展示图标、名称、描述、开关控件和删除按钮
- **AND** 条目视图按钮 MUST 成为激活态

#### Scenario: 技能广场 Tab 隐藏视图切换
- **WHEN** 用户切换到"技能广场" Tab
- **THEN** 视图切换控件 MUST 不可见（`hidden`）
- **AND** 列表 MUST 以宫格形式渲染

### Requirement: 技能卡片渲染

每个技能 MUST 以卡片形式展示，包含：图标（SVG inline）、标题、描述（最多 2 行截断）、标签（已安装 / 官方 / 自建）、安装数、使用数、预计积分、快捷操作按钮（使用 / 安装）。

#### Scenario: 已安装技能卡片渲染
- **WHEN** 技能在本地已安装（`lock.json` 中存在或 `skills/` 目录中存在）
- **THEN** 卡片 MUST 展示绿色"已安装"标签（Success Green-1 底色 + Green-7 文本）
- **AND** 快捷操作区域 MUST 展示"使用"按钮（链接至 `href`）
- **AND** "使用"按钮颜色 MUST 为 Brand-6 `#FF6F00`

#### Scenario: 未安装官方技能卡片渲染
- **WHEN** 技能未在本地安装且来源为官方
- **THEN** 卡片 MUST 展示蓝色"官方"标签（Info Blue-1 底色 + Blue-6 文本）
- **AND** 快捷操作区域 MUST 展示"安装"按钮

#### Scenario: 自建技能卡片渲染
- **WHEN** 技能来源为自建（用户工作区技能）
- **THEN** 卡片 MUST 展示橙色"自建"标签（Brand-1 底色 + Brand-7 文本）
- **AND** 快捷操作区域 MUST 展示"使用"按钮

#### Scenario: 卡片悬停显示快捷操作
- **WHEN** 用户将鼠标悬停在卡片上
- **THEN** 快捷操作区域 MUST 从透明变为可见（`opacity: 0 → 1` 过渡）

### Requirement: 预计积分展示（本期固定值）

技能卡片 meta 行 MUST 展示"预计 X 积分"文本。本期 `points` 字段**不进行动态计算**，固定展示"预计8积分"。详见 `skills-plaza-api` capability 的 points 字段说明。

#### Scenario: 积分固定值展示
- **WHEN** 卡片渲染技能 meta 信息
- **THEN** "预计积分"文本 MUST 固定为"预计8积分"
- **AND** MUST NOT 根据技能类型、步骤数或其他因素动态计算

### Requirement: 安装技能

用户点击"安装"按钮 MUST 触发安装流程。安装 MUST 通过 host-api 调用后端 `StoSkillService`，完成后刷新列表并展示 Toast 反馈。

#### Scenario: 安装官方技能
- **WHEN** 用户点击某官方技能卡片的"安装"按钮
- **THEN** 按钮 MUST 进入 loading 状态（不可重复点击）
- **AND** 系统 MUST 调用 `POST /api/skill-plaza/install` 触发安装
- **AND** 安装完成后按钮 MUST 变为"使用"
- **AND** 卡片标签 MUST 更新为"已安装"
- **AND** 系统 MUST 展示 Toast "安装成功，正在生效"

#### Scenario: 安装失败
- **WHEN** 安装过程中发生错误
- **THEN** 按钮 MUST 恢复可点击状态
- **AND** 系统 MUST 展示 Toast 错误提示

### Requirement: 使用技能（跳转对话）

已安装技能的"使用"按钮 MUST 跳转到对话页面，并预填充该技能关联的初始 prompt。

#### Scenario: 点击使用按钮
- **WHEN** 用户点击已安装技能的"使用"按钮
- **THEN** 系统 MUST 导航至 `conversation.html?q=<encodedPrompt>`（或等价路由）
- **AND** URL 中的 `q` 参数 MUST 为该技能配置的默认使用 prompt

### Requirement: 删除技能（仅我的技能 Tab）

在"我的技能" Tab 的条目视图下，自建 / 已安装技能 MUST 展示删除按钮。删除 MUST 弹出确认弹窗，确认后从本地移除技能。

#### Scenario: 展示删除按钮
- **WHEN** 用户在"我的技能" Tab 的条目视图下查看技能列表
- **THEN** 每个条目右侧 MUST 展示删除按钮（垃圾桶图标）

#### Scenario: 点击删除触发确认弹窗
- **WHEN** 用户点击删除按钮
- **THEN** 系统 MUST 弹出确认弹窗
- **AND** 弹窗 MUST 展示"确定要删除该技能吗？删除后将从「我的技能」中移除。"
- **AND** 弹窗 MUST 包含"取消"和"删除"两个按钮

#### Scenario: 确认删除
- **WHEN** 用户在确认弹窗中点击"删除"
- **THEN** 系统 MUST 调用 `POST /api/skill-plaza/uninstall`
- **AND** 删除完成后 Toast MUST 展示"已删除"
- **AND** 该技能 MUST 从"我的技能"列表中移除
- **AND** 若该技能存在于"技能广场" Tab，其状态 MUST 从"已安装"变为可安装状态

#### Scenario: 取消删除
- **WHEN** 用户在确认弹窗中点击"取消"或点击背景遮罩
- **THEN** 弹窗 MUST 关闭
- **AND** 技能 MUST NOT 被删除

### Requirement: Toast 通知

安装、删除等操作完成后 MUST 展示底部居中 Toast 通知，2.2 秒后自动消失。

#### Scenario: 操作反馈 Toast
- **WHEN** 安装 / 删除操作成功完成
- **THEN** 页面底部 MUST 弹出 Toast
- **AND** Toast 背景 MUST 为 Grey-10 80% 透明
- **AND** Toast MUST 在 2.2 秒后自动隐藏

### Requirement: 广场数据通过 host-api 获取

页面所有数据请求 MUST 通过 `src/lib/host-api.ts` 发起，MUST NOT 直接调用 Gateway HTTP 端点或使用 `window.electron.ipcRenderer.invoke()`。接口契约详见 `skills-plaza-api` capability。

#### Scenario: 加载广场列表
- **WHEN** 技能广场页面挂载
- **THEN** 系统 MUST 调用 `hostApiFetch('/api/skill-plaza/list')` 获取广场技能列表
- **AND** MUST NOT 新增 `fetch('http://127.0.0.1:18789/...')` 调用

#### Scenario: 加载我的技能列表
- **WHEN** 用户切换至"我的技能" Tab
- **THEN** 系统 MUST 调用 `hostApiFetch('/api/skill-plaza/mine')` 获取已安装技能列表

### Requirement: 分页阈值展示

当技能总数超过分页阈值（本期固定为 50）时，前端 MUST 展示分页控件。详见 `skills-plaza-api`capability 的分页策略说明。

#### Scenario: 技能数量未超过阈值
- **WHEN** 列表接口返回 `hasMore: false`
- **THEN** 页面 MUST NOT 展示分页控件
- **AND** 所有技能以当前视图模式完整展示

#### Scenario: 技能数量超过阈值
- **WHEN** 列表接口返回 `hasMore: true`
- **THEN** 页面 MUST 展示分页控件（页码或"加载更多"）
- **AND** 用户翻页时 MUST 请求下一页数据
- **AND** 下期迭代将支持 `page` 和 `pageSize` 查询参数

### Requirement: 列表 loading 与 error 状态

数据加载中 MUST 展示 loading 状态，加载失败 MUST 展示 error 状态与重试操作。

#### Scenario: 加载中
- **WHEN** 广场列表请求尚未返回
- **THEN** 页面 MUST 展示 loading 骨架屏或 spinner

#### Scenario: 加载失败
- **WHEN** 广场列表请求失败
- **THEN** 页面 MUST 展示错误提示与"重试"按钮

### Requirement: 主题对齐

技能广场页面视觉样式 MUST 遵循 `docs/sto-design.md` 色彩体系。

#### Scenario: 主操作颜色
- **WHEN** 页面中展示"使用"按钮、视图切换激活态、分类导航激活文字
- **THEN** 颜色 MUST 使用 Brand-6 `#FF6F00`

#### Scenario: 标签颜色
- **WHEN** 卡片展示"已安装" / "官方" / "自建"标签
- **THEN** 已安装标签 MUST 使用 Green-1/Green-7、官方标签 MUST 使用 Blue-1/Blue-6、自建标签 MUST 使用 Brand-1/Brand-7

#### Scenario: 删除按钮颜色
- **WHEN** 确认弹窗中的"删除"按钮
- **THEN** 按钮颜色 MUST 使用 Danger Red-6 `#FA3C3C`

### Requirement: 国际化

技能广场所有用户可见文案 MUST 支持 i18n，使用 `skills` 命名空间。

#### Scenario: 切换语言后页面文案更新
- **WHEN** 用户在设置中切换语言后返回技能广场
- **THEN** 标题、Tab 标签、搜索占位符、排序选项、空态文案、Toast 文案等 MUST 使用对应语言版本的 i18n 翻译
