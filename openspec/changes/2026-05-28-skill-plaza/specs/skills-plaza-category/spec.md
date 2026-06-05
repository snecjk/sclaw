# Capability: `skills-plaza-category`（本 change 新增）

## 新增需求

### Requirement: 后端分类定义与管理

系统 MUST 在后端维护技能分类定义。分类信息存储在 `skills` 表的两个字段中：`category_code`（英文 slug，用于过滤/计数）和 `category`（中文展示名称，用于前端渲染）。

#### Scenario: 获取分类列表
- **WHEN** 前端调用 `GET /api/skill-plaza/categories`
- **THEN** 后端 MUST 从 `skills` 表中 `SELECT DISTINCT category_code, category` 去重获取有效分类
- **AND** MUST 补充内置默认分类（全部 / 技术 / 产品 / 设计 / 行政 / 财务 / HR / 通用 / 模板 / 网络 / 政策 / 运营 / 客服 / 其他），确保即使某分类下暂无可展示技能时分类项仍然存在
- **AND** 返回的每项 MUST 包含 `slug`（对应 `category_code`）和 `label`（对应 `category`）

#### Scenario: 分类顺序
- **WHEN** 前端渲染分类导航
- **THEN** 分类项 MUST 按前端内置的业务约定顺序渲染：全部 → 技术 → 产品 → 设计 → 行政 → 财务 → HR → 通用 → 模板 → 网络 → 政策 → 运营 → 客服 → 其他
- **AND** "全部"分类 MUST 始终在第一位

### Requirement: 技能归属分类

每个技能数据 MUST 包含 `category`（中文 label）和 `categoryCode`（英文 slug）字段，一个技能 MUST 仅归属一个分类。

#### Scenario: 广场列表包含分类信息
- **WHEN** 前端调用 `GET /api/skill-plaza/list` 或 `GET /api/skill-plaza/mine`
- **THEN** 每条技能数据 MUST 包含 `category`（中文 label）和 `categoryCode`（英文 slug）字段
- **AND** `categoryCode` 值 MUST 为已定义的某个分类 slug 或 `null`

#### Scenario: 未分类技能
- **WHEN** 某技能的 `category_code` 字段为空或未匹配到已知分类
- **THEN** 该技能的 `categoryCode` 和 `category` 字段 MUST 为 `null`
- **AND** 该技能 MUST 仅在"全部"分类中展示

### Requirement: 分类计数

分类导航中每个分类项右侧 MUST 展示当前 Tab + 搜索条件下的技能数量。计数 MUST 由后端在返回列表时计算并提供，通过响应中的 `categoryCounts` 字段返回。详见 `skills-plaza-api` capability 的接口契约。

#### Scenario: 分类计数更新
- **WHEN** 用户切换 Tab 或输入搜索关键词
- **THEN** 系统 MUST 调用对应列表接口获取最新的 `categoryCounts`
- **AND** 分类导航中各分类项右侧的计数 MUST 实时更新

### Requirement: 分类数据表内存储

分类定义不再使用独立配置文件或分类表，而是通过 `skills` 表的 `category_code` + `category` 双字段直接存储。内置默认分类作为后端代码常量维护。

#### Scenario: 应用启动加载分类数据
- **WHEN** Electron Main 进程启动并初始化 `SkillPlazaService`
- **THEN** 系统 MUST 以内置默认分类常量作为基础分类列表
- **AND** 从 `skills` 表中读取实际存在的 `category_code` / `category` 去重值进行补充

#### Scenario: 分类数据缺失时兜底
- **WHEN** `skills` 表中所有记录的 `category_code` 均为空
- **THEN** 系统 MUST 返回内置默认分类列表（全部 / 技术 / 产品 / 设计 / 行政 / 财务 / HR / 通用 / 模板 / 网络 / 政策 / 运营 / 客服 / 其他）
- **AND** 所有技能的 `category` / `categoryCode` MUST 默认为 `null`
