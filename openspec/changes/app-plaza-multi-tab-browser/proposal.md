## Why

应用广场今天用「单抽屉 webview」打开业务应用：切到聊天等其它 claw 路由会关闭抽屉并销毁会话，回到广场等于重新打开。用户需要 Chrome 式多页签：固定首页看广场、可开空白浏览器输入网址、同 URL 复用、收藏进「我的应用」，且切换 claw 路由不中断正在使用的应用。同时必须限制同时存活的 webview 数量，避免多页签拖垮本机性能。

## What Changes

- 将 `/more-apps` 升级为「应用广场壳」：顶部 Chrome 式页签栏 + 内容区
- **首页页签**固定、不可关闭，内容为现有应用广场（市场 / 我的应用）
- 首页右侧可新增**空白浏览器页签**；用户输入网址后加载；从卡片/Banner 打开应用时，**同 URL 复用已有页签**，否则新开
- 浏览器页签支持**收藏**，写入「我的应用」（复用现有 registry / external / favorite 契约）
- 浏览器页签保留现有**侧边 AI 聊天**能力（按页签/应用维度）
- 离开应用广场路由时：壳**完全不可见但进程仍在**（不销毁活跃 webview）；再次进入不重置页签
- 同时**最多 5 个**存活（已挂载 webview）的浏览器页签；超出则停掉最久未用页签的 webview；用户点回被停掉的页签时**重新加载**
- 深色模式：页签栏、地址栏、收藏与休眠态指示须使用语义主题 token，保证对比度与选中/悬停态可读

## Capabilities

### New Capabilities
- `app-plaza-browser-tabs`: 应用广场内 Chrome 式多页签、URL 复用、空白页、收藏、5 活页上限与休眠重载、侧边 AI 聊天
- `app-plaza-shell-keepalive`: 应用广场壳在离开 `/more-apps` 时保活（隐藏不卸载），侧边栏再进入不重置

### Modified Capabilities
- （无独立已归档 marketplace spec 需 MODIFIED 拷贝；实现时替换现有单会话抽屉在广场内的打开路径，其它入口行为在 design 中约定）

## Impact

- `src/components/more-apps/`：壳、页签栏、首页内容嵌入
- `src/components/sclaw-browser/`：由单抽屉会话扩展为多页签会话模型（或并列多会话宿主）
- `src/stores/`：新增多页签 / 壳可见性 store；调整 `sclaw-browser-overlay` 与侧边栏关闭逻辑
- `src/lib/open-sclaw-browser.ts`：广场内打开改为「开/激活页签」
- `src/components/layout/`（`MainLayout` / `Sidebar`）：壳挂载与「切路由不关页签」
- `shared/more-apps-registry` / `useMoreAppsStore`：收藏从浏览器页签写入「我的应用」
- 主题：对齐 `docs/sto-design.md`；须覆盖 dark mode
- 文档：`README*.md` 若描述应用打开方式则同步更新
