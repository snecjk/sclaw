## Context

应用广场目前由 `builtin-apps.ts` 提供静态应用、分类和 Hero 数据，Zustand Store 只管理本地 UI、外部应用、收藏及伪安装状态。后端新接口在 SQL 层按当前员工执行状态和人员授权过滤，并返回真实最近使用时间，因此服务端数据必须成为生产目录的唯一权威来源。项目要求 Renderer 经 `host-api` 调用 Main，不直接访问后端或管理鉴权 Token。

## Goals / Non-Goals

**Goals:**

- 从服务端加载当前员工可见应用、分类和有效 Banner。
- 保持搜索、分类、分页、打开应用及“我的应用”体验可用。
- 由 Main 进程持有并转发当前会话 `stoToken`。
- 保留本地外部应用和收藏，并避免同机账号之间共享个人数据。

**Non-Goals:**

- 不实现后端未提供的收藏、安装、卸载或打开记录写接口。
- 不修改目标业务应用自身鉴权。
- 不为 APP Banner 猜测或拼接后端未返回的目标 URL。

## Decisions

### 1. Main 进程代理服务端目录

Renderer 通过 `/api/app-plaza/apps|categories|banners` 调用新 Host API 路由，路由委托 `AppPlazaService` 使用 `memoryCenterFetchForSession()` 请求后端。

**Rationale:** 这符合 Renderer/Main API 边界，并确保业务可见性使用当前会话身份而非 AI 资源身份。

**Alternative considered:** Renderer 直接把 Zustand 中的 `stoToken` 发到 `/agent/v1/app-plaza/*`。这会让 Renderer 承担后端地址、Token 和传输策略，不符合项目约束，因此不采用。

### 2. 服务端搜索、分类和分页

应用查询使用 `pageNum`、`pageSize`、`keyword`、`categoryCode`，搜索采用短防抖，切换搜索或分类时重置为第一页；页面提供继续加载。

**Rationale:** 后端在分页前完成权限过滤，`total` 只统计当前用户可见应用；服务端查询可避免全量加载和未授权数据混入。

**Alternative considered:** 首次请求 `pageSize=100` 后继续前端过滤。该方案对超过 100 个应用不完整，也浪费后端分页能力，因此不采用。

### 3. Banner 按后端契约降级

URL Banner 直接打开 `targetUrl`，NONE Banner 不可点击；APP Banner 仅在当前缓存中能找到 `targetAppId` 对应应用时可点击，否则只展示。

**Rationale:** 当前 Banner 契约没有目标 APP URL，也没有按 appId 查询接口，客户端不能安全猜测目标地址。

**Alternative considered:** 为找目标 APP 拉取所有分页或把 `targetAppId` 拼成 URL。前者成本无界，后者不符合契约，因此不采用。后续后端可返回目标应用最小快照或提供详情接口。

### 4. 本地个人数据按员工隔离

外部应用和收藏使用包含 `userCode` 的 localStorage key；首次读取账号专属 key 为空时兼容迁移旧 key。服务端应用目录不落本地静态兜底。

**Rationale:** 本地能力仍需保留，但不能在同一桌面客户端的不同账号间共享。

**Alternative considered:** 继续使用全局 key。该方案会导致总部、网点切换时个人应用互相可见，因此不采用。

### 5. 删除伪安装对页面语义的控制

服务端应用点击即打开；“我的应用”由外部应用和收藏的服务端应用组成。旧 installed key 不再决定列表或按钮状态。

**Rationale:** 后端没有安装接口，当前 installedIds 仅记录一次点击且“我的应用”实际也不使用它，继续展示安装状态会误导用户。

**Alternative considered:** 保留本地安装 ID。它无法跨设备同步，也没有实际安装行为，因此不采用。

## Risks / Trade-offs

- **[Risk]** APP Banner 的目标应用不在当前已加载分页中时无法跳转。→ **Mitigation:** Banner 仍展示但禁用点击；记录为后端契约增强项。
- **[Risk]** 后端不可用导致广场没有内置应用。→ **Mitigation:** 展示符合 `docs/sto-design.md` 中 Danger/中性表面语义的错误与重试状态，不回退可能绕过授权的静态目录。
- **[Risk]** 用户快速输入触发过期响应覆盖新搜索。→ **Mitigation:** Store 使用请求序号，仅最后一次重置请求可提交结果。
- **[Risk]** 后端返回未知 `tone`、`kind` 或不安全 URL。→ **Mitigation:** Renderer API 适配器执行运行时归一化并只接受 HTTP/HTTPS URL。

## Migration Plan

1. 发布新 Host API 和 Renderer 客户端。
2. 页面改用服务端目录并保留旧静态文件但不再作为生产数据源，便于短期回滚。
3. 首次访问按员工迁移旧外部应用和收藏数据。
4. 回滚时恢复静态目录引用；服务端和本地数据无需迁移。

## Open Questions

- 后端是否会补充 APP Banner 的目标应用快照或按 ID 查询接口？
- `recent` 使用记录由哪个调用方写入，是否需要新增客户端打开上报接口？
