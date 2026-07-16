## Context

应用广场市场 Tab 的三个红框区域当前都来自 `src/components/more-apps/builtin-apps.ts`：Banner 使用 `MARKET_HERO_SLIDES` 加 APP 元数据拼装复杂卡片，分类由 `BUILTIN_APPS.category` 去重生成，APP 列表直接读取 `BUILTIN_APPS`。memory-center 的 `app_plaza_client.py` 已在 `/agent/v1/app-plaza` 下提供 `banners`、`categories`、`apps` 三个 POST 查询接口，并按当前员工执行服务端可见性过滤。

## Goals / Non-Goals

**Goals:**

- Banner 改为后台上传的完整图片，保留轮播容器和圆点，点击行为由 Banner 目标字段决定。
- 分类使用服务端分类编码和名称，并驱动 APP 的服务端分类筛选。
- APP 列表使用服务端名称、描述、图标和地址，支持关键词、分页和点击打开。
- 三块内容分别加载和降级，单块失败不破坏另外两块。

**Non-Goals:**

- 不改“我的应用”、收藏、外部应用安装及本地持久化。
- 不新增 Banner 内部标题、图标、能力 stats 等结构化配置；这些内容应制作在 `imageUrl` 指向的整张图片中。
- 不新增或修改 memory-center 管理端接口。

## Decisions

### 1. Banner 使用整图渲染

Banner 组件仅使用 `id`、`imageUrl`、`targetType`、`targetUrl`、`targetAppId` 和 `order`。图片使用等比裁切或适配填满现有 Banner 容器，轮播顺序使用接口顺序/`order`；删除页面对 `theme`、`stats` 和模拟 `appId` 的生产依赖。

**Rationale:** 产品已确认 Banner 后续是一张图片和链接，完整运营视觉应由后台图片承载，前端无需重复维护其内部结构。

**Alternative considered:** 继续由前端根据 title、subtitle、APP 图标和 stats 拼装 Banner。后端没有 stats 字段，且每次运营内容变化都需要前端发版，因此不采用。

### 2. Banner 目标按现有枚举执行

- `URL`：有效 `targetUrl` 时点击后使用现有 SClaw 内置浏览器打开。
- `NONE`：只展示图片，不可点击。
- `APP`：仅当当前已加载 APP 数据中存在 `targetAppId` 时使用该 APP 的 `url` 打开；否则展示但不可点击。

**Rationale:** 这是当前 `/banners` 返回字段能够安全支持的完整行为，不能根据 APP 编码猜测 URL。

**Alternative considered:** 所有 Banner 都直接读取 `targetUrl`。管理端约束要求 APP 类型的 `targetUrl` 为空，因此该方案会让 APP 类型无法工作。

### 3. 分类使用 id/name 映射

前端固定插入 `{ id: 'featured', label: '精选' }`，接口项映射为 `{ id: category.id, label: category.name }`，保持服务端返回顺序。选择“精选”时不传 `categoryCode`；选择其他项时将 `id` 作为 `/apps` 的 `categoryCode`。

**Rationale:** 后端分类 `id` 即稳定 `category_code`，`name` 即页面显示文案，完全覆盖当前分类组件需要。

**Alternative considered:** 继续从 APP 的 category 文案去重生成分类。该方案丢失服务端编码和排序，也可能显示服务端未返回的空分类，因此不采用。

### 4. APP 列表服务端驱动

APP 行使用 `id`、`name`、`description`、`url`、`iconKey`、`iconUrl`、`tone`；`categoryCode` 用于契约一致性，`recent` 可作为现有/后续辅助展示。关键词或分类变化时重置到第一页，继续加载时请求下一页并按 `id` 去重合并。

**Rationale:** 后端在分页前完成状态与人员可见性过滤，服务端 `total` 是市场数量的权威来源。

**Alternative considered:** 拉取最多 100 条后继续在前端搜索和分类。该方案无法覆盖更大目录，也会重复服务端能力，因此不采用。

### 5. 经 Main 进程代理三个接口

Renderer 调用 `/api/app-plaza/banners|categories|apps`，Main 使用当前会话 Token 转发到 memory-center 的 POST 接口。三个前端请求可并发，状态分别维护；APP 查询错误显示重试，Banner 或分类错误分别隐藏对应动态内容/保留“精选”。

**Rationale:** 符合项目 Renderer/Main API 边界，并避免 Renderer 持有后端域名和鉴权策略。

**Alternative considered:** Renderer 直接请求 memory-center 并传 `stoToken`。这违反项目通信边界，因此不采用。

## Risks / Trade-offs

- **[Risk]** APP 类型 Banner 的目标应用不在当前 APP 分页内，无法取得 URL。→ **Mitigation:** Banner 保持展示但不可点击；后续如要求保证跳转，后端增加目标 APP URL/快照或详情接口。
- **[Risk]** Banner 图片尺寸不统一造成裁切。→ **Mitigation:** 约定后台图片比例并在组件使用固定容器与 `object-fit`；视觉边框、圆角和圆点继续遵循 `docs/sto-design.md` 的页面表面语义。
- **[Risk]** 三个接口任一失败导致整个市场空白。→ **Mitigation:** 分离加载状态，分类失败仍可展示“精选”，Banner 失败不阻塞 APP，APP 失败显示明确重试。
- **[Risk]** 静态 mock 兜底绕过服务端人员可见性。→ **Mitigation:** 生产页面不使用静态 APP/分类作为失败兜底。

## Migration Plan

1. 先增加 Main 代理、类型适配和测试。
2. 分类与 APP 列表切换到服务端。
3. Banner 组件切换为整图模式并删除模拟结构依赖。
4. 保留静态文件短期便于代码回滚，但生产页面不再引用三类模拟导出。

## Open Questions

- 后台 Banner 图片的推荐宽高比和最小分辨率需要产品/设计确认。
- 是否允许配置 APP 类型 Banner；若必须保证任意分页下可跳转，后端需补目标 APP URL 或快照。
