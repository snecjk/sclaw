## 1. Main 进程查询代理

- [x] 1.1 新增/整理应用广场查询服务，使用当前登录会话 Token 以 POST 调用 memory-center 的 `/agent/v1/app-plaza/banners`、`categories`、`apps`（Requirement: 三块内容经 Main 代理且独立降级）
- [x] 1.2 注册 `/api/app-plaza/banners`、`/api/app-plaza/categories`、`/api/app-plaza/apps` Host API 路由，并将 apps 的 `pageNum`、`pageSize`、`keyword`、`categoryCode` query 参数原样映射（Requirement: 三块内容经 Main 代理且独立降级；Requirement: APP 列表使用服务端目录）

## 2. Renderer 数据模型与状态

- [x] 2.1 定义 Banner、分类和 APP 客户端类型及响应适配器，校验 Banner 图片/跳转 URL 仅允许 HTTP/HTTPS，APP URL 原样保留，并为未知图标色调提供安全默认值（Requirement: Banner 使用服务端整图内容；Requirement: APP 列表使用服务端目录）
- [x] 2.2 将市场 Tab 的 Banner、分类和 APP 状态改为异步服务端状态，分别维护 loading/error，APP 支持重置查询、分页追加和请求竞态保护（Requirement: 三块内容经 Main 代理且独立降级；Requirement: APP 列表使用服务端目录）
- [x] 2.3 保持“我的应用”、收藏和外部应用现有行为不变，避免本次 Store 调整扩大到非目标区域（Requirement: 三块内容经 Main 代理且独立降级）

## 3. Banner 整图接入

- [x] 3.1 将当前 `MARKET_HERO_SLIDES` 的 theme/stats/结构化预览渲染替换为 `/banners` 返回的 `imageUrl` 整图轮播，保留现有容器、圆角、阴影和轮播圆点（Requirement: Banner 使用服务端整图内容）
- [x] 3.2 实现 Banner 目标行为：URL 打开 `targetUrl`、NONE 不跳转、APP 仅在已加载 APP 可解析时打开，无法解析时不得猜测 URL（Requirement: Banner 使用服务端整图内容）
- [x] 3.3 增加无 Banner、单 Banner、多 Banner、图片加载失败及请求失败的展示处理，不使用静态模拟 Banner 兜底（Requirement: Banner 使用服务端整图内容；Requirement: 三块内容经 Main 代理且独立降级）

## 4. 分类与 APP 列表接入

- [x] 4.1 用 `/categories` 返回的 `id`/`name` 替换静态分类，前端固定补充“精选”，保持服务端顺序（Requirement: 分类导航使用服务端分类）
- [x] 4.2 分类点击时将非精选分类 `id` 作为 `categoryCode` 重置查询 `/apps`，点击精选时不传 `categoryCode`（Requirement: 分类导航使用服务端分类）
- [x] 4.3 用 `/apps` 返回的 `id`、`name`、`description`、`iconKey`/`iconUrl`、`tone`、`url` 渲染现有双列 APP 行，并使用服务端 `total` 更新市场数量（Requirement: APP 列表使用服务端目录）
- [x] 4.4 将搜索框接入 `keyword` 防抖查询并实现分页加载更多；请求失败显示重试且不回退静态 APP（Requirement: APP 列表使用服务端目录；Requirement: 三块内容经 Main 代理且独立降级）

## 5. 测试与文档检查

- [x] 5.1 增加 Main 服务/路由测试，验证三个后端 POST 路径、当前会话鉴权和 apps query 参数（Requirement: 三块内容经 Main 代理且独立降级）
- [x] 5.2 增加 Renderer 适配、状态和页面测试，覆盖整图 Banner 目标行为、分类映射、APP 搜索/分页及三块独立失败（Requirement: Banner 使用服务端整图内容；Requirement: 分类导航使用服务端分类；Requirement: APP 列表使用服务端目录）
- [x] 5.3 运行相关 Vitest、定向 ESLint、TypeScript 类型检查、`git diff --check` 和 OpenSpec 严格校验（Requirement: 三块内容经 Main 代理且独立降级）
- [x] 5.4 检查 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需要同步应用广场数据源说明（Requirement: 三块内容经 Main 代理且独立降级）
- [x] 5.5 解除 APP URL 的前端协议限制并增加相对地址、非 HTTP/HTTPS 协议及空地址适配测试（Requirement: APP 列表使用服务端目录）
- [x] 5.6 将 APP 列表副标题从服务端 `description` 切换为 `badge`，并增加字段选择回归测试（Requirement: APP 列表使用服务端目录）
- [x] 5.7 将逗号分隔的 `badge` 拆分为符合 STO UI 主题的单行圆角标签，并覆盖空项过滤与多标签渲染测试（Requirement: APP 列表使用服务端目录）
- [x] 5.8 将 APP 标签限制为每行最多三个，第四个起换行，并覆盖四标签分组测试（Requirement: APP 列表使用服务端目录）
- [x] 5.9 将“我的应用”角标改为按收藏与外部应用 ID 并集计数，并覆盖同一外部应用被收藏时不重复计数的回归测试（Requirement: 我的应用计数不重复）
- [x] 5.10 将“我的应用”角标改为直接使用当前渲染卡片数量，并覆盖无法解析的注册表 ID 对应空态显示 0 的回归测试（Requirement: 我的应用计数与当前卡片一致）
- [x] 5.11 分离市场当前查询结果与“我的应用”会话目录快照，并覆盖分类切换后收藏卡片与角标保持不变的回归测试（Requirement: 我的应用独立于市场分类）
