## Why

应用广场当前使用前端硬编码的应用、分类、推荐轮播和最近使用文案，无法反映服务端配置、当前员工授权或真实使用记录。后端现已提供按员工可见性过滤的应用、分类与 Banner 查询接口，需要将页面切换到权威服务端数据源。

## What Changes

- 通过 Main 进程 Host API 代理接入 `/agent/v1/app-plaza/apps`、`categories`、`banners` 三个只读接口，鉴权由 Main 使用当前登录会话 `stoToken` 完成。
- 应用列表、分类、Banner、分页总数及最近使用时间改由服务端驱动，移除生产页面对静态内置目录与静态轮播的依赖。
- 搜索、分类筛选和分页使用服务端参数，页面增加加载、失败重试和空状态。
- 保留用户本地添加的外部应用和收藏，并按当前员工工号隔离本地存储。
- 将当前伪“安装”状态收敛为打开/收藏语义；“我的应用”继续展示本地外部应用和收藏的服务端应用。

## Capabilities

### New Capabilities

- `app-plaza-backend-catalog`: 定义应用广场从服务端加载当前员工可见应用、分类和 Banner，并与本地个人数据组合展示的行为。

### Modified Capabilities

- 无。

## Impact

- 新增 Electron 应用广场服务、Host API 路由和 Renderer API 客户端。
- 调整 `src/stores/more-apps.ts`、`MoreAppsPage.tsx`、应用类型及相关测试。
- 不新增依赖，不修改构建、打包或通信传输策略。
- 继续复用现有页面和 `docs/sto-design.md` 视觉语义，不引入新的主题 token。
