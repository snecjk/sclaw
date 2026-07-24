## Why

“应用广场”路由和页面已经可供主应用用户使用，但侧边栏目前仅向网点账号展示入口，导致总部、省区等非网点账号无法通过正常导航发现该功能。现在需要统一入口可见性，让所有已登录账号都能从侧边栏进入应用广场。

## What Changes

- 移除“应用广场”侧边栏入口对网点账号类型的限制。
- 保持现有 `/more-apps` 路由、页面内容、应用安装与打开行为不变。
- 增加导航可见性回归测试，覆盖非网点账号场景。

## Capabilities

### New Capabilities

- `more-apps-access`: 定义所有已登录账号均可从主导航发现并进入应用广场。

### Modified Capabilities

- 无。

## Impact

- 影响 `src/components/layout/Sidebar.tsx` 中主导航过滤逻辑及相关单元测试。
- 不新增或修改 API、依赖、存储格式、路由与页面视觉样式。
- 页面及侧栏现有样式继续遵循 `docs/sto-design.md`，本变更不引入新的主题或视觉 token。
