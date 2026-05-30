# Capability: `skills-plaza-category`（本 change 新增）

## 新增需求

### Requirement: 后端分类定义与管理

系统 MUST 在后端维护技能分类定义，包括分类列表和每个技能到分类的映射关系。分类数据 MUST 通过 `GET /api/skill-plaza/categories` 接口暴露给前端。

#### Scenario: 获取分类列表
- **WHEN** 前端调用 `GET /api/skill-plaza/categories`
- **THEN** 后端 MUST 返回如下结构的 JSON：
  - `categories`: 数组，每项包含 `id`（唯一标识）、`slug`（kebab-case）、`label`（展示名称）、`order`（排序权重）
  - 初始分类 MUST 包含：全部（`all`）、经营管理（`operations`）、财务管理（`finance`）、异常监控（`monitor`）、外部市场（`market`）、办公（`office`）

#### Scenario: 分类顺序
- **WHEN** 前端渲染分类导航
- **THEN** 分类项 MUST 按 `order` 字段升序排列
- **AND** "全部"分类 MUST 始终在第一位

### Requirement: 技能归属分类

每个技能数据 MUST 包含 `category` 字段，值为其所属分类的 `slug`。一个技能 MUST 仅归属一个分类。

#### Scenario: 广场列表包含分类信息
- **WHEN** 前端调用 `GET /api/skill-plaza/list` 或 `GET /api/skill-plaza/mine`
- **THEN** 每条技能数据 MUST 包含 `category` 字段
- **AND** `category` 值 MUST 为后端已定义的某个分类 `slug` 或 `null`

#### Scenario: 未分类技能
- **WHEN** 某技能在后端分类映射中未配置归属
- **THEN** 该技能的 `category` 字段 MUST 为 `null`
- **AND** 该技能 MUST 仅在"全部"分类中展示

### Requirement: 分类计数

分类导航中每个分类项右侧 MUST 展示当前 Tab + 搜索条件下的技能数量。计数 MUST 由后端在返回列表时计算并提供，通过响应中的 `categoryCounts` 字段返回。详见 `skills-plaza-api` capability 的接口契约。

#### Scenario: 分类计数更新
- **WHEN** 用户切换 Tab 或输入搜索关键词
- **THEN** 系统 MUST 调用对应列表接口获取最新的 `categoryCounts`
- **AND** 分类导航中各分类项右侧的计数 MUST 实时更新

### Requirement: 分类数据本地配置持久化

分类定义和技能-分类映射 MUST 存储在本地配置文件中（`skill-categories.json`），位于 Electron 资源目录或用户配置目录。应用启动时 MUST 加载该文件。

#### Scenario: 应用启动加载分类配置
- **WHEN** Electron Main 进程启动并初始化 `SkillPlazaService`
- **THEN** 系统 MUST 读取本地分类配置文件
- **AND** 配置文件 MUST 作为后续 API 响应的数据源

#### Scenario: 配置文件缺失时使用默认分类
- **WHEN** 本地分类配置文件不存在
- **THEN** 系统 MUST 使用内置默认分类（全部 / 经营管理 / 财务管理 / 异常监控 / 外部市场 / 办公）
- **AND** 所有技能的 `category` MUST 默认为 `null`
