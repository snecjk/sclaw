## 1. Main 进程数据代理

- [x] 1.1 新增应用广场服务与响应类型，使用当前会话 Token 调用 apps、categories、banners 接口（Requirement: 当前员工可见应用由服务端提供；Requirement: 有效 Banner 由服务端提供）
- [x] 1.2 新增 `/api/app-plaza/*` Host API 路由并注册到服务器，正确转发查询参数和错误状态（Requirement: 当前员工可见应用由服务端提供；Requirement: 分类搜索和分页由服务端驱动）

## 2. Renderer 数据模型与 Store

- [x] 2.1 扩展应用、分类、Banner 类型并新增 Renderer API 适配器，完成 URL、枚举和 recent 归一化（Requirement: 服务端数据经过安全适配）
- [x] 2.2 将 more-apps Store 改为服务端目录状态，支持初始化、重置查询、分页合并、请求竞态和错误重试（Requirement: 当前员工可见应用由服务端提供；Requirement: 分类搜索和分页由服务端驱动）
- [x] 2.3 初版实现按员工工号隔离的 localStorage（后由 2.4 按产品要求纠偏）
- [x] 2.4 纠偏：恢复 `main` 的 `~/.stoclaw/more-apps/apps.json` 注册表和旧 localStorage 迁移，服务端目录查询保持不变（Requirement: 收藏与外部应用沿用 Main 本地注册表）

## 3. 页面接入

- [x] 3.1 页面加载服务端应用、分类和 Banner，增加加载、错误、重试与加载更多状态（Requirement: 当前员工可见应用由服务端提供；Requirement: 有效 Banner 由服务端提供）
- [x] 3.2 将搜索和分类切换接入服务端查询，保留“我的应用”为外部应用加收藏应用（Requirement: 分类搜索和分页由服务端驱动；Requirement: 收藏与外部应用沿用 Main 本地注册表）
- [x] 3.3 按 URL、APP、NONE 实现 Banner 行为并移除生产页面对静态轮播和伪安装状态的依赖（Requirement: 有效 Banner 由服务端提供）

## 4. 验证与文档

- [x] 4.1 增加服务、路由适配、Store 与页面关键逻辑测试（Requirement: 当前员工可见应用由服务端提供；Requirement: 服务端数据经过安全适配）
- [x] 4.2 运行相关单元测试、定向 lint、类型检查和 OpenSpec 严格校验（Requirement: 当前员工可见应用由服务端提供；相关测试与 lint、OpenSpec 校验通过，全量类型检查仍被仓库既有错误阻断，本次文件无新增类型错误）
- [x] 4.3 检查 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 的同步需求并记录结论（Requirement: 当前员工可见应用由服务端提供；当前仓库仅有 `README.md` 且未描述应用广场数据源，无需更新）
- [x] 4.4 增加 Main 文件注册表与 Renderer 收藏持久化测试，并重新运行定向测试、类型检查和 OpenSpec 严格校验（Requirement: 收藏与外部应用沿用 Main 本地注册表；22 个定向用例、定向 ESLint 与 OpenSpec 严格校验通过，全量类型检查仍被仓库既有错误阻断，本次文件无新增类型错误）
