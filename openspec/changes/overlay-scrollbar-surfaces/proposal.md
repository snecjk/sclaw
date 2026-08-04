## Why

侧边栏与对话流当前使用原生 WebKit scrollbar + `useNativeScrollbarActivity`（120ms stop debounce）控制 thumb 显隐。该方案无法满足跨平台一致的贴边、不占宽 Overlay 目标：

1. Windows classic scrollbar 或 `scrollbar-gutter: stable` 仍占用内容宽度。
2. 对话 viewport 位于带水平 padding 的父容器内，thumb 无法贴主卡片最右边。
3. 侧边栏右侧 gutter 造成中部内容左右有效空间不一致。
4. macOS 系统 overlay scrollbar 受系统设置影响，无法保证与 Windows 行为一致。

产物 HTML 预览（Electron webview 根 viewport 铺满）可作为视觉参照，但不是可直接复用的实现。需要应用级 Overlay Scrollbar，在保留真实 scroll viewport 与既有滚动语义的前提下，统一 macOS/Windows 视觉与活动行为。

## What Changes

- 新增共享 Overlay Scrollbar 原件（metrics 纯函数 + activity Hook + 渲染组件 + scoped CSS）。
- 首批接入：侧边栏中部滚动区、Home `HomeMainConversation` 非 split / split 对话流、内嵌浏览器 Chat。
- 目标 surface 隐藏原生可见 scrollbar / classic stable gutter；thumb 绝对定位于所属 surface 右边，不参与布局。
- 保留现有 `scrollRef` / `contentRef` / `scrollContainerRef` owner，以及 sticky、自动收起、自动滚底、用户离底语义。
- 不改造非目标滚动区；不删除全局 scrollbar CSS；旧 `src/pages/Chat/index.tsx` 默认不接入（`/chat` 重定向到 `/`）。

## Capabilities

### New Capabilities

- `overlay-scrollbar-surfaces`: 应用级 Overlay Scrollbar 共享原件与目标 surface 接入契约（贴边、活动显隐、拖动、不占布局宽度、light/dark/reduced-motion/forced-colors）

### Modified Capabilities

- None（核对 `openspec/specs/` 现有 published specs 后，无既有 capability 文件必须修改；本变更不重复改写 chat/sidebar 业务语义，仅新增跨模块滚动视觉契约）

## Impact

- Renderer：共享 UI/hook/metrics、`globals.css` scoped 规则；Sidebar、Home 对话布局分层、Embed Chat
- 不涉及 API / IPC / Gateway / Main / 持久化 / 依赖 / 工程配置
- Dark mode：thumb 颜色复用现有 thin-scrollbar light/dark 透明度；forced-colors 下恢复原生 scrollbar 优先可用性
