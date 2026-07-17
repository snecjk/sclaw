## Why

应用广场的 Banner、分类和 APP 列表目前由前端静态模拟数据提供，无法随后台配置更新，也没有应用当前员工的服务端可见性规则。后端已经提供三个对应的只读查询接口，需要让这三块页面内容使用服务端权威数据。

## What Changes

- Banner 区从当前前端拼装的模拟卡片改为“后台配置的一张完整图片 + 点击目标”，数据来自 `POST /agent/v1/app-plaza/banners`。
- 分类导航改用 `POST /agent/v1/app-plaza/categories` 返回的 `id` 和 `name`；“精选”继续由前端固定提供，选择服务端分类时将分类 `id` 作为 `categoryCode` 查询 APP。
- APP 列表改用 `POST /agent/v1/app-plaza/apps`，使用服务端返回的名称、徽标文案（`badge`）、图标、色调和 URL 渲染并打开应用；APP URL 由服务端负责其格式与有效性，前端不做协议限制或条目过滤。
- APP 搜索、分类筛选和分页通过 `/apps` 的 query 参数由服务端执行。
- 三个请求均经 Main 进程 Host API 代理并使用当前登录会话的 `stoToken`，Renderer 不直接调用 memory-center。
- 接口失败时展示加载失败与重试状态，不回退到可能绕过人员可见性规则的静态应用数据。

## Capabilities

### New Capabilities

- `app-plaza-catalog-content`: 定义应用广场 Banner、分类导航和 APP 列表三块内容的服务端数据接入、渲染与交互契约。

### Modified Capabilities

- 无。

## Impact

- 影响应用广场页面、Zustand Store、应用广场类型与数据客户端。
- 新增 Main 进程应用广场查询服务及 `/api/app-plaza/*` Host API 路由。
- 前端生产页面不再依赖 `builtin-apps.ts` 中的 `BUILTIN_APPS`、`MARKET_CATEGORIES` 和 `MARKET_HERO_SLIDES` 模拟内容。
- 不修改“我的应用”、收藏、安装外部应用等非本次三块内容。
- Banner 外框、轮播圆点和页面布局继续遵循 `docs/sto-design.md`；Banner 内部视觉由后台上传的完整图片承载。
