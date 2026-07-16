## ADDED Requirements

### Requirement: 当前员工可见应用由服务端提供

系统 MUST 通过 Main 进程代理调用应用广场应用查询接口，并使用当前登录会话 `stoToken` 获取经过服务端状态门禁和人员授权过滤的应用；Renderer MUST NOT 直接调用后端或直接管理该请求的鉴权 Token。

#### Scenario: 首次进入应用广场
- **WHEN** 已登录用户进入应用广场
- **THEN** 系统 MUST 请求第一页当前员工可见应用并展示服务端返回的总数和应用数据

#### Scenario: 应用接口失败
- **WHEN** 应用查询返回鉴权错误或网络错误
- **THEN** 系统 MUST 展示错误与重试入口且 MUST NOT 回退到静态内置应用目录

### Requirement: 分类搜索和分页由服务端驱动

系统 MUST 从分类接口加载当前员工至少拥有一个可见应用的分类，并 MUST 将关键词、分类编码、页码和页大小传给应用查询接口；筛选变化时 MUST 从第一页重新查询。

#### Scenario: 用户切换分类
- **WHEN** 用户选择一个服务端分类
- **THEN** 系统 MUST 使用该分类的 `categoryCode` 重置并查询应用列表

#### Scenario: 用户搜索应用
- **WHEN** 用户输入名称或描述关键词并结束短暂输入
- **THEN** 系统 MUST 使用防抖后的关键词重置并查询应用列表

#### Scenario: 用户加载下一页
- **WHEN** 当前已加载数量小于服务端 `total` 且用户请求继续加载
- **THEN** 系统 MUST 请求下一页并将结果按稳定 ID 合并到现有列表

### Requirement: 有效 Banner 由服务端提供

系统 MUST 从 Banner 接口加载当前员工有效 Banner，并 MUST 按 `targetType` 执行 URL、APP 或 NONE 行为；系统 MUST NOT 为后端未提供的目标应用猜测 URL。

#### Scenario: URL Banner
- **WHEN** 用户点击 `targetType=URL` 且 `targetUrl` 有效的 Banner
- **THEN** 系统 MUST 使用现有应用内浏览器打开目标 URL

#### Scenario: APP Banner 目标已加载
- **WHEN** 用户点击 `targetType=APP` 且当前应用缓存包含 `targetAppId`
- **THEN** 系统 MUST 使用该应用的现有打开链路打开目标应用

#### Scenario: APP Banner 目标未加载
- **WHEN** `targetType=APP` 但当前应用缓存不包含 `targetAppId`
- **THEN** 系统 MUST 展示 Banner 但 MUST NOT 猜测或打开未知 URL

### Requirement: 本地个人应用数据按用户隔离

系统 MUST 保留用户添加的外部应用和收藏，并 MUST 使用当前员工工号隔离本地存储；“我的应用” MUST 由本地外部应用和当前用户收藏的可见服务端应用组成。

#### Scenario: 同机切换账号
- **WHEN** 桌面客户端从一个员工账号切换到另一个员工账号
- **THEN** 系统 MUST 加载新员工自己的外部应用和收藏且 MUST NOT 展示前一员工的个人数据

#### Scenario: 收藏服务端应用
- **WHEN** 用户收藏一个当前可见的服务端应用
- **THEN** 系统 MUST 将其加入该用户的“我的应用”并持久化该用户的收藏 ID

### Requirement: 服务端数据经过安全适配

系统 MUST 将服务端响应适配为前端类型，对未知色调和类型使用安全默认值，并 MUST 仅允许 HTTP 或 HTTPS 应用及 Banner 目标 URL 进入打开链路；ISO `recent` MUST 格式化为用户可读时间。

#### Scenario: 服务端返回未知展示枚举
- **WHEN** 应用响应包含前端不认识的 `tone` 或 `kind`
- **THEN** 系统 MUST 使用安全的默认图标色调和内置应用类型继续渲染

#### Scenario: 服务端返回不安全 URL
- **WHEN** 应用或 Banner 的目标 URL 不是 HTTP/HTTPS
- **THEN** 系统 MUST 阻止该 URL 进入打开链路
