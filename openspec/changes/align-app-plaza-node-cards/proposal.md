## Why

当前应用广场的市场列表仍采用大图轮播和双列纵向条目，与最新设计稿的紧凑三列节点卡片不一致；应用图片和标签字段也未按后台上传内容的展示契约呈现。需要统一市场节点的信息层级，让用户可以更快浏览应用名称、上传图片和标签。

## What Changes

- 应用广场市场区改为设计稿中的紧凑三列节点卡片，并为窄窗口提供响应式降列。
- 每个节点直接展示应用记录中的上传图片；图片不可用时保留稳定的占位表现。
- 将应用标签字段解析后用中文顿号“、”连接为单行次要文案。
- 分类导航展示各分类对应的应用总数，并与列表接口的权威 `total` 保持一致。
- 保留现有分类、搜索、收藏、打开、分页和异常降级行为。
- 可见颜色、边框、文本层级遵循 `docs/sto-design.md`，并覆盖浅色与深色模式。

## Capabilities

### New Capabilities

- `app-plaza-marketplace-cards`: 定义应用广场市场节点的图片、标签文本、卡片布局、交互与响应式展示契约。

### Modified Capabilities

- 无。

## Impact

- 影响 `src/components/more-apps/MoreAppsPage.tsx`、`AppIcon.tsx`、`more-apps.css` 及相关测试。
- 不改变 Main/Renderer API 边界、后端接口、数据持久化或依赖配置。
