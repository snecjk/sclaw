## ADDED Requirements

### Requirement: Banner 使用服务端整图内容

系统 MUST 从 `POST /agent/v1/app-plaza/banners` 加载当前员工有效 Banner，并 MUST 使用每项 `imageUrl` 作为 Banner 的完整视觉内容；生产页面 MUST NOT 再依赖前端模拟的 `theme`、`stats` 或结构化预览卡片生成 Banner 内部内容。

#### Scenario: 展示有效 Banner
- **WHEN** Banner 接口返回一个或多个有效项
- **THEN** 系统 MUST 按服务端顺序在现有轮播区域展示对应完整图片，并在多项时提供轮播圆点

#### Scenario: URL 类型 Banner
- **WHEN** 用户点击 `targetType=URL` 且 `targetUrl` 为有效 HTTP/HTTPS 地址的 Banner
- **THEN** 系统 MUST 使用现有 SClaw 内置浏览器打开该地址

#### Scenario: NONE 类型 Banner
- **WHEN** Banner 的 `targetType=NONE`
- **THEN** 系统 MUST 展示图片且 MUST NOT提供点击跳转

#### Scenario: APP 类型目标不可解析
- **WHEN** Banner 的 `targetType=APP` 但当前已加载 APP 中不存在 `targetAppId`
- **THEN** 系统 MUST 展示图片但 MUST NOT猜测应用地址或触发跳转

### Requirement: 分类导航使用服务端分类

系统 MUST 从 `POST /agent/v1/app-plaza/categories` 加载分类，将 `id` 作为分类编码、`name` 作为分类显示名称，并 MUST 在服务端分类前保留前端固定的“精选”分类。

#### Scenario: 渲染服务端分类
- **WHEN** 分类接口返回启用且包含可见 APP 的分类
- **THEN** 系统 MUST 按接口顺序展示分类的 `name` 并使用对应 `id` 作为交互标识

#### Scenario: 选择服务端分类
- **WHEN** 用户选择一个非“精选”分类
- **THEN** 系统 MUST 将分类 `id` 作为 `categoryCode` 重置查询 APP 第一页

#### Scenario: 选择精选
- **WHEN** 用户选择“精选”
- **THEN** 系统 MUST 重置查询 APP 第一页且 MUST NOT传递 `categoryCode`

### Requirement: APP 列表使用服务端目录

系统 MUST 从 `POST /agent/v1/app-plaza/apps` 加载当前员工可见 APP，并 MUST 使用服务端 `total`、分页结果及 APP 的名称、徽标文案（`badge`）、图标、色调和 URL 渲染市场列表。系统 MUST 原样保留服务端 APP URL，且 MUST NOT因 URL 协议、相对地址或空地址过滤 APP 条目。

#### Scenario: 渲染 APP 行
- **WHEN** APP 接口返回可见应用
- **THEN** 每个应用行 MUST 使用 `id` 作为稳定标识，展示 `name`、`badge`、`iconKey`/`iconUrl` 和 `tone`；`badge` MUST 按中英文逗号拆分并去除空项，以符合 `docs/sto-design.md` 的 Grey-3 背景、Grey-9 文字圆角标签展示，每行 MUST 最多展示三个标签且后续标签 MUST 换行；系统 MUST NOT 使用 `description` 作为列表副标题，并在 URL 非空时将服务端原始 `url` 交给现有应用打开逻辑

#### Scenario: APP URL 不受前端协议限制
- **WHEN** APP 接口返回相对地址、非 HTTP/HTTPS 协议或空 `url` 的可见应用
- **THEN** 系统 MUST 继续渲染该应用且 MUST NOT在客户端适配阶段改变其 `url`

#### Scenario: 搜索 APP
- **WHEN** 用户在市场 Tab 输入搜索关键词并结束短暂输入
- **THEN** 系统 MUST 将防抖后的关键词作为 `keyword` 重置查询 APP 第一页

#### Scenario: 加载更多 APP
- **WHEN** 当前已加载数量小于服务端 `total` 且用户请求继续加载
- **THEN** 系统 MUST 请求下一页并按 APP `id` 去重追加列表

### Requirement: 三块内容经 Main 代理且独立降级

Renderer MUST 通过 Host API 获取 Banner、分类和 APP，Main MUST 使用当前登录会话鉴权转发到 memory-center；三个区域 MUST 独立处理加载和失败，且生产页面 MUST NOT在接口失败时回退到静态 APP、分类或 Banner mock。

#### Scenario: Banner 请求失败
- **WHEN** Banner 请求失败但 APP 请求成功
- **THEN** 系统 MUST 继续展示 APP 列表且 MUST NOT使用模拟 Banner 替代

#### Scenario: 分类请求失败
- **WHEN** 分类请求失败但 APP 请求成功
- **THEN** 系统 MUST 保留“精选”并继续展示未分类筛选的 APP 列表

#### Scenario: APP 请求失败
- **WHEN** APP 请求失败
- **THEN** 系统 MUST 展示列表加载失败和重试入口且 MUST NOT展示静态模拟 APP

### Requirement: 我的应用计数与当前卡片一致

系统 MUST 使用“我的应用”区域当前实际渲染的卡片集合计算该 Tab 的角标数量，角标 MUST 始终等于当前可见卡片数量。

#### Scenario: 注册表 ID 无法渲染为卡片
- **WHEN** 收藏或安装注册表中存在无法在当前“我的应用”区域渲染的应用 ID
- **THEN** 系统 MUST NOT 将该 ID 计入角标；若区域为空，角标 MUST 显示 `0`

#### Scenario: 当前区域存在应用卡片
- **WHEN** “我的应用”区域经过搜索过滤后实际渲染 N 张应用卡片
- **THEN** “我的应用”角标 MUST 显示 N

### Requirement: 我的应用独立于市场分类

系统 MUST 将应用广场当前分类/搜索结果与“我的应用”可解析目录分开维护；切换应用广场分类或搜索条件 MUST NOT 移除“我的应用”中已经加载的收藏应用。

#### Scenario: 分类结果不包含已收藏应用
- **WHEN** 用户已收藏应用 A，随后在应用广场选择不包含 A 的分类
- **THEN** 应用广场 MUST 展示新分类结果，但“我的应用”仍 MUST 展示应用 A，且角标数量 MUST 保持与其实际卡片数量一致
