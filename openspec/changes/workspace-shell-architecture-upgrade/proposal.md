## Why

省区 AppShell、可拖拽侧边栏、三栏 Workbench、Header 槽位与 Toast 定位目前分属多份活动 OpenSpec 与局部补丁，几何不变量互相冲突：

1. 省区仍是 flex + collapsed 条件 padding，无法稳定表达「Sidebar | 8px L0 Frame | L1 Workspace」。
2. Sidebar 固定 260/72，省区收起写死为 0；Workflow editor 直接改写用户 `sidebarCollapsed` 偏好。
3. Preview 只有 boolean；产物展开走 DOM Fullscreen；split 左右各 10px inset + Handle `row-span-2`/`translate-x(10px)` 形成结构空缝。
4. Header 槽位同时存在 `actions` / 文档中的 `panelActions` / 目标 `previewActions` 语义，无法统一。
5. Toast 在 `App.tsx` 写死 `72/260`，Settings / no-sidebar 路由会错误偏移。
6. OverlayScrollbar 已落地，但后续三栏改造若重写滚动逻辑会破坏贴边契约。

需要一份统一架构 Change，串行承载四阶段实施，并修订冲突的活动 OpenSpec。

## What Changes

- 新建统一 Change `workspace-shell-architecture-upgrade`，覆盖四个 capability（见下）。
- Stage 0 只建档：proposal / design / specs / tasks；**不改** `src/`、`electron/`、tests、样式。
- 删除方案冲突：DOM Fullscreen → Workspace 内 `PreviewMode.expanded`；删除 10px×2 结构空缝；删除 Handle `row-span-2` + `translate-x(10px)`；Toast 改读 effective sidebar width；Header 最终只保留 `chatActions + previewActions + layoutMode`。
- OverlayScrollbar **只复用**，本 Change 不重写 metrics/hook/组件。
- 修订活动 Change：`chat-file-preview-enhancement`、`unify-toast-and-chat-error-feedback`、`overlay-scrollbar-surfaces/tasks.md`（状态校准）。
- 四个响应式最低宽度已批准并写入 design：`closedWorkspaceMin=560`、`splitChatMin=480`、`splitPreviewMin=560`、`expandedPreviewMin=640`。进入阶段 1 源码仍需用户完成 Stage 0 文档验收（tasks 0.8）。

## Capabilities

### New Capabilities

- `app-shell-foundation`：省区三列 Grid、8px L0 Frame、`AppShellLayoutProvider`、collapse reasons、Toast/Header 消费 effective snapshot
- `resizable-sidebar-shell`：200–400 拖拽、默认 260、吸附/收起阈值、viewport/context 原因、持久化 `sidebarPreferredWidth`
- `workspace-layout-modes`：`PreviewMode` closed/split/expanded、零 seam 分栏、Body-only Handle、统一 Header 槽位命名、Conversation 保活
- `shell-surface-hierarchy`：L0/L1/L2/L3 层级语义、light/dark 同结构所有权、集成验收不变量

### Modified Capabilities

- 无 published `openspec/specs/` 基线需 MODIFIED；冲突通过修订活动 Change 文档解决（见 Impact）。

## Impact

- 后续阶段（用户验收 Stage 0 后）：`MainLayout`、`Sidebar`、`ContentHeader`/`content-header-context`、`surfaces.ts`、`globals.css` tokens、`settings` store、`App.tsx` Toaster、Home/Chat preview 布局、`FilePreviewViewer`/`ChatPreviewPanel` 去掉 DOM Fullscreen 方向
- 不改 Gateway / IPC 协议 / 依赖 / lockfile / 构建 / CI
- Dark mode：结构所有权不变；阶段 4 校准 Surface 色与阴影
- 依赖活动 Change：`overlay-scrollbar-surfaces`（只读复用）；与 `chat-file-preview-enhancement`、`unify-toast-and-chat-error-feedback` 冲突条款已在本 Stage 0 同步修订

## Out of Scope (Stage 0)

- 任何 UI / 源码实现
- 自动进入阶段 1（须用户验收 tasks 0.8）
