# 阶段 5：工作区几何所有权与稳定顶栏收口 · Cursor T2 开发文档

> 仓库：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 风险等级：Tier 2（AppShell 边界、统一顶栏与 Workbench Surface 几何收口）
>
> 前置：阶段 1–4 已实施；本阶段用于修正人工视觉验收暴露的结构错误
>
> 本文优先级：用户最新文字要求与最新设计节点之后，高于原总纲中被本文明确撤销的旧几何条款
>
> 本轮建档日期：2026-08-01

## 0. 给执行模型的第一原则

本阶段不是“按截图补几个 margin”。四类现象来自同一问题：尺寸变量和布局槽位的所有权错误。

必须通过以下结构收口解决：

1. Sidebar 拖拽命中区不再占真实 Grid 列宽。
2. macOS chrome safe inset 只属于 Header，不得下放到 `main` 或 Preview Body。
3. Conversation / Split / Preview Expanded 共用一棵稳定的 Header DOM。
4. Search 是 Header 内的临时浮层工具，不得通过普通 Flex 宽度推动其他按钮。
5. DOM box center、SVG 可见图形中心、macOS 原生按钮中心分别验证，禁止混为一谈。

禁止使用负 margin、逐按钮 `translate-y`、模式专用 magic number 或切换后 `setTimeout` 重新定位来通过单张截图。

## 1. 本文撤销的旧条款

下列旧条款已经被人工验收和运行时测量证明会导致当前问题，自本文起不再执行：

### 1.1 撤销 AppShell 固定三列 Gap

旧：

```text
Sidebar | 8px L0 Gap / Resize Track | Workspace
```

新：

```text
Sidebar | Workspace
            ↑
            8px Resize Hit Area 以 overlay 覆盖在 Workspace 起始侧，不占布局宽度
```

`8px` 仍可作为拖拽命中宽度、Workspace top/right/bottom Frame 和普通 Surface inset，但不得继续作为 Sidebar 与 Workspace 之间的真实 Grid Track。

### 1.2 撤销 `stoSplitShellInsetsClass` 挂整个 main

Header 左侧的 macOS 避让值不得成为 `main`、Split Body 或 Preview Expanded Body 的水平 padding。

### 1.3 撤销三套独立 Header 模板

旧阶段 3 中“conversation / split / preview-expanded 三模板”的做法被撤销。三种模式必须使用同一棵 Header DOM，只允许 CSS grid-area / visibility 改变。

### 1.4 撤销“禁止重构 Header DOM”的旧结论

旧文档曾基于 DOM control centerY=34 得出“不重写 Header DOM”。该结论只证明按钮外框垂直居中，不能证明模式切换的水平锚点稳定。本阶段允许且要求把三套 return 收敛成稳定槽位，但不得改业务 Slot 数据协议。

### 1.5 Header 基准锁定为 52px

旧阶段文档中残留的 `56px` 基线无效。权威基线为：

```text
Workspace top frame = 8px
ContentHeader top   = 8px
ContentHeader h     = 52px
ContentHeader centerY = 34px
Header action box   = 32px
Search surface      = 32px
```

## 2. 最新设计稿的状态解读

用户 2026-08-01 最新顶部设计截图表达三个状态。执行时如可使用设计 MCP，必须读取下列已登记节点及用户指定的最新 collapsed Header 节点；图片缩放图只用于理解状态，不用于反推像素。

| 状态 | 设计表达 | 必须保持的不变量 |
| --- | --- | --- |
| A. Sidebar 展开 + Split | 左 Sidebar；中 Conversation；右 Preview；Header 连续 | Header 52；Split Header/Body 共边界；Workspace 右 Frame 稳定 |
| B. Sidebar 展开 + Preview Expanded | Sidebar 保留；Preview 占满 Workspace | Header 中 icon/Tab 组与下方 Surface 共用 12px 左边界；右侧布局按钮位置不变 |
| C. Sidebar 收起 + Preview Expanded | Workspace 占据窗口；macOS 控件仍在左上 | Header 单独避让红黄绿；Preview Body 左右各保留 12px inset，不能出现 80px 空白 |

已登记设计节点：

```text
根区域：48:10836
三栏展开：48:10928
Preview Expanded：48:11093
Sidebar 宽度拖动：48:14421
Sidebar 最小：48:13442
Sidebar 最大：48:13949
```

如果 MCP 中的新 Frame 与本文数值冲突：

1. 用户最新文字要求优先。
2. Header 52px、Search 32px、Sidebar 200/260/400 已明确批准，不允许普通模型自行覆盖。
3. 其他差异先报告，不得用局部 CSS 猜测。

## 3. 当前代码事实与根因

### 3.1 Sidebar 视觉偏心

当前 `stoAppShellGridProvincialClass` 使用：

```css
grid-template-columns:
  var(--sto-sidebar-effective-w)
  var(--sto-shell-card-gap)
  minmax(0, 1fr);
```

当前运行时示例：

```text
Sidebar:  x=0, width=224
Scrollbar: x=214..224
Workspace: x=232
```

Scrollbar 已贴 Sidebar 右边界，真正的空隙是其后的 8px Grid 列。浅色下该列与 Sidebar 同色，视觉会把 224+8 当成 Sidebar，而内容只在 224 内居中，因此产生约 4px 的光学偏移。

同一旧 Gap 还被两个纯函数消费：

- `SHELL_FRAME_HORIZONTAL_PX=16` 按“中间 Gap 8 + Workspace right Frame 8”计算 Sidebar `effectiveMax`。
- `computeToastLayoutOffsetPx()` 返回 `effectiveSidebarWidth + 8`，按旧三列 Workspace Track 居中 Toast。

删除实体 Gap 时必须同步这两个消费者，禁止只改 CSS Grid。

### 3.2 Header 外框居中但可见图形未完全居中

运行时 DOM 已证明 Header 和按钮 box centerY 均为 34px。剩余问题来自：

- Electron 原生 traffic lights 不参与 React flex 对齐。
- SVG 源文件 viewBox / 可见图形尺寸不同。
- 三种 Header 模式父容器不同，水平锚点发生变化。

### 3.3 Search 外层不是 32px

当前 Input 已经是 `h-8`，但外层仍有 `py-1.5` 和 border，搜索胶囊约 44–46px。它还以 `w-[16.5rem]` 进入普通 Flex 流，打开时会挤压标题和推动 action。

### 3.4 Preview Expanded 大空白

`stoSplitShellInsetsClass` 将 `--sto-content-header-pad-start` 挂到整个 `main`。Sidebar 收起的 macOS 条件又将该变量提高到 `5rem`，于是 80px Header 避让被错误施加到 Preview Body。

### 3.5 右侧布局按钮切换位移

`ContentHeader.tsx` 对三种 `layoutMode` 使用三套 return；`previewActions` 在不同模式进入不同父级。位置变化是重排结果，不是动画误差。

## 4. 目标 AppShell 架构

```text
AppShellRoot (position:relative)
├─ NativeChromeLayer
├─ SidebarTrack (width = effectiveSidebarWidth)
│  └─ Sidebar
│     └─ SidebarScrollHost
│        ├─ ScrollViewport
│        └─ OverlayScrollbar (right=0)
├─ WorkspaceTrack (minmax(0,1fr))
│  └─ WorkspaceFrame (top/right/bottom=8)
└─ SidebarResizeBoundary (absolute overlay)
```

### 4.1 AppShell Grid

目标：

```css
grid-template-columns:
  var(--sto-sidebar-effective-w)
  minmax(0, 1fr);
```

坐标不变量：

```text
sidebarRight = workspaceLeft
resizeBoundaryLeft = workspaceLeft
scrollbarRight = sidebarRight
```

允许误差：`≤1px`。

水平可用宽公式同步改为：

```text
provincial shellFrameHorizontal = Workspace right Frame = 8px
effectiveSidebarMax = viewportWidth - 8 - workspaceRequiredWidth
```

`workspaceRequiredWidth` 的 560 / 480+560 / 640 批准值不变；只删除旧中间 Gap 对水平 Frame 的 8px 占用。

Toast 继续按 Workspace Track 居中时：

```text
toast layout offset = effectiveSidebarWidth
```

不得继续额外加已不存在的 provincial Gap 8px。Settings/no-sidebar 仍为 0，full legacy 仍使用其真实 rail 宽度。

### 4.2 SidebarResizeBoundary

命中区：

```text
width = 8px
left = effectiveSidebarWidth
覆盖方向 = Workspace 一侧
```

推荐结构语义：

```css
position: absolute;
inset-block: 0;
inset-inline-start: var(--sto-sidebar-effective-w);
width: var(--sto-sidebar-resize-hit-w, 8px);
```

提示线固定在命中区左边缘，即真实 Sidebar/Workspace 边界。不得居中覆盖到 Sidebar 滚动条上。

### 4.3 Workspace 外框

Workspace Wrapper 继续拥有：

```text
top    = 8px
right  = 8px
bottom = 8px
left   = 0px（Sidebar 边界处不再放结构 Gap）
```

Preview Expanded 的左右各 `12px` 内容 inset 属于 Workbench Body，不属于 AppShell Gap。该值由设计节点 `48:11093` 的 `1152px Workspace - 1128px Surface = 24px` 确认。

### 4.4 Collapse

省区收起：

```text
effectiveSidebarWidth = 0
Workspace left = 0
ResizeBoundary 不渲染
Header 用 macOS safe slot 避让
Body 不继承 macOS safe inset
```

Full legacy 72px rail 仍保持现状，不受本阶段省区规则影响。

## 5. 几何 Token 所有权

禁止一个 Token 跨越 Native Chrome、Header、Body 三层使用。

### 5.1 Window / Workspace Frame

```css
--sto-workspace-frame-top: 8px;
--sto-workspace-frame-right: 8px;
--sto-workspace-frame-bottom: 8px;
```

可在兼容期映射到现有 `--sto-shell-card-gap`，但代码注释必须说明该旧变量不再代表 Sidebar/Workspace gap。

### 5.2 Header Chrome

```css
--sto-content-header-h: 52px;
--sto-header-pad-start: 20px;
--sto-header-pad-end: 8px;
--sto-header-macos-safe-start: 80px;
--sto-header-effective-start: var(--sto-header-pad-start);
```

macOS + Sidebar collapsed：

```css
--sto-header-effective-start:
  max(var(--sto-header-pad-start), var(--sto-header-macos-safe-start));
```

这个值只允许在 Header Root / Header Start Slot 使用。

### 5.3 Workbench Body

```css
--sto-workbench-header-to-body-gap: 8px;
--sto-split-header-to-surface-gap: 0px;
--sto-workbench-body-content-inset-y: 8px;
--sto-workbench-surface-bottom-inset: 8px;
--sto-preview-expanded-header-to-surface-gap: 0px;
--sto-split-preview-inset-x: 0px;
--sto-expanded-preview-inset-x: 12px;
```

### 5.4 Token 迁移表

| 旧用法 | 新所有者 | 处理 |
| --- | --- | --- |
| `--sto-shell-card-gap` 同时表示 Frame 和中间 Grid 列 | Workspace Frame | 删除中间 Grid 列语义 |
| `SHELL_FRAME_HORIZONTAL_PX=16` | Sidebar effective max | 省区新结构改为仅 right Frame 8px |
| Toast offset = effective Sidebar + 8 | Workspace Track center | 改为 effective Sidebar；no-sidebar=0 |
| `--sto-content-header-pad-start` 挂 Header 和 main | Header Chrome | main 禁止消费 |
| `stoSplitShellInsetsClass` 挂 split/expanded main | Header/Body 各自 inset | 删除 main 使用，随后删除/弃用该 class |
| Preview Expanded 继承 `5rem` | Header safe slot | Body 改用左右各 12px 的 Expanded 独立 inset |

## 6. 稳定 ContentHeader DOM

### 6.1 单一组件树

禁止在 `ContentHeader` 中保留三套顶层 return。目标结构：

```tsx
<header data-layout-mode={layoutMode}>
  <div data-slot="chat-header-zone">
    <div data-slot="sidebar-title" />
    <div data-slot="chat-actions" />
  </div>

  <div data-slot="preview-header-zone">
    <div data-slot="preview-tabs" />
    <div data-slot="workspace-actions" />
  </div>
</header>
```

`title`、`chatActions`、`previewTabs`、`previewActions`、`layoutMode` 的注册协议保留；不新建第二套 Context，也不把 PreviewMode 放入 AppShell Context。

### 6.2 模式只改变 Grid Area

#### conversation

```text
[Sidebar restore + title ........ chat actions] [workspace actions]
```

#### split

```text
[title ........ chat actions] [0px boundary] [preview tabs .... workspace actions]
```

#### preview-expanded

```text
[Sidebar restore + preview tabs ................ workspace actions]
```

### 6.3 WorkspaceActions 固定锚点

`previewActions` 中的预览开关属于 `workspace-actions`。它在三种模式中必须始终：

```text
right = Workspace 右边缘 - 8px
centerY = 34px
```

模式切换前后按钮 `x` 差值 `≤1px`。

不要把 Preview Action Row 内的“最大化/恢复产物”按钮和 ContentHeader 的“显示/收起预览区”按钮混为同一槽位；两者语义独立，但各自在自己的右侧 action rail 内稳定。

### 6.4 Sidebar restore

`SidebarHeaderToggle` 只允许一个渲染位置。当前 `titleZone` 内和 `preview-expanded` 分支外层的重复条件必须收敛为 `sidebar-title` 槽位内容。

## 7. Search 32px 与无重排展开

### 7.1 尺寸

目标是整个 Search Surface 32px：

```text
Search outer surface = 32px
Search toggle         = 32×32px
Search leading icon   = 24×24px
Prev/Next/Close       = 24×24px
vertical padding      = 0
```

Input 可以 `h-full` 或 28px，但不得用“Input 32px + outer py-1.5”再次生成 44–46px 胶囊。

### 7.2 展开模型

Search Toggle 始终只占 32px。Search Panel 作为相对 Toggle 的绝对定位子层向左展开：

```text
right = toggle width + 4px
top = 0
height = 32px
max width 受 Chat Header Zone 限制
```

Search 打开不得改变：

- Header height。
- refresh / brain / preview toggle 的 x。
- split boundary。
- preview tabs 的可用列边界。

Search 必须保留 `Escape`、`Enter`、`Shift+Enter`、自动聚焦、清空和结果导航行为；整块使用 `no-drag`。

## 8. 垂直中心与图标资产

### 8.1 DOM 几何

自动化必须验证：

```text
header top=8
header h=52
header centerY=34
32px action centerY=34
30px tab centerY=34
search surface centerY=34
```

### 8.2 SVG 光学中心

Search / Refresh / Brain / Panel 当前源 SVG 的 viewBox 和可见图形高度不同。应统一到共享 16×16 画布，或由设计资产提供规范化 SVG。禁止在按钮 class 上增加 `translate-y`。

验收分两层：

1. DOM box center 误差 `≤1px`。
2. 设计/人工截图的可见图形光学中心无明显跳动。

### 8.3 macOS traffic lights

设计稿不包含原生 traffic lights，最终必须用真实 macOS 应用截图验收。

建议将纯几何常量放到 Main/Renderer 都能安全读取的共享 TypeScript 模块，避免 `content-header-metrics.ts` 和 `electron/main/index.ts` 各写一份数值。

不得修改 Electron 构建配置。只允许在现有源码边界内共享常量。

## 9. Preview Body Surface

### 9.1 Split

```text
chatPaneRight
= chatOverlayScrollbarRight
= logicalSplitBoundary
= previewPanelLeftBorder
```

Split Preview 左 inset 为 0；Resize Handle 仍是 Preview 侧 Body-only overlay。

### 9.2 Preview Expanded

`main` 占满 Workspace，不消费 Header safe inset。Expanded Body 自己提供正常 inset：

```text
top = 8px
left/right = 8px（以最新 MCP 精确值为准；不得超过正常 Surface token）
bottom = 0/8px 由现有 Workspace bottom frame 与面板滚动契约共同决定
```

明确禁止：

```text
Preview left = 20px/80px because Header padding
negative margin-left: -80px
collapsed 专用 Preview 修补 class
```

## 10. Light / Dark 层级

结构调整后 light/dark 使用同一 DOM 与几何：

```text
L0 Shell/Sidebar
L1 Workspace
L2 Preview/Composer
L3 Floating
```

删除 8px 中间布局列后，不允许在 dark 模式重新画一条颜色 Gap 伪造旧层级。Resize Boundary 默认透明，只在 hover/drag/focus 显示语义化提示线。

检查改动组件不得新增 light-only `bg-white`；颜色继续使用 `docs/sto-design.md` 与现有 Surface Token。

## 11. 性能与状态约束

- 保留现有 `AppShellLayoutProvider`，不新增万能 Layout Provider。
- Sidebar pointermove 继续 RAF 写 CSS variable，不逐帧 setState/Store。
- 绝对定位 Resize Boundary 直接读取同一个 effective width CSS variable。
- Header mode 切换只改变 attribute/class，不重复挂载 Search、Tabs 或 Action 状态。
- Conversation 在 Preview Expanded 中继续保持挂载。
- 不新增 ResizeObserver；继续使用 AppShell 现有唯一窗口尺寸入口。
- 不重写 OverlayScrollbar primitive、metrics 或活动状态逻辑。

## 12. 实施白名单

默认允许：

```text
src/components/layout/MainLayout.tsx
src/components/layout/ContentHeader.tsx
src/components/layout/sidebar-resize-handle.tsx
src/components/layout/sidebar-header-toggle.tsx（仅槽位接线需要时）
src/components/layout/app-shell-layout-context.tsx（仅几何 consumer 接线/注释校准）
src/lib/surfaces.ts
src/lib/app-shell-metrics.ts
src/lib/sidebar-resize-metrics.ts
src/lib/content-header-metrics.ts
src/styles/globals.css
src/App.tsx（仅 Toast 几何消费不变量需要时）
src/pages/Chat/ChatSearchBar.tsx
src/pages/Chat/ChatPreviewHeaderTabs.tsx（仅稳定 slot 尺寸）
electron/main/index.ts（仅共享 chrome metric/真实校准）
tests/unit/app-shell-geometry.test.tsx
tests/unit/app-shell-metrics.test.ts
tests/unit/sidebar-resize-metrics.test.ts
tests/unit/content-header-layout.test.tsx
tests/unit/sidebar-resize-handle.test.tsx
tests/unit/chat-search-bar.test.tsx
tests/e2e/ 或现有 Electron/Playwright 几何用例（若当前测试基础可用）
openspec/changes/workspace-shell-architecture-upgrade/**
.cursor/rules/02-styles.mdc（实现验证完成后同步）
```

默认禁止：

```text
业务消息发送/Gateway/IPC
Chat Preview 文件内容渲染逻辑
Sidebar 项目/任务/最近业务列表
OverlayScrollbar primitive/hook/metrics
Settings Store 持久化字段
package.json / lockfile / build / scripts / CI
```

如果必须越过白名单，先停止并报告原因，不得顺手扩大范围。

## 13. 串行开发任务

### 5A：现场复测与测试先行

- 重新读取本文件、最新 MCP 节点、当前 git diff。
- 用运行时 `getBoundingClientRect` 记录 Sidebar/Workspace/Header/Search/Preview/按钮基线。
- 新增会失败的几何关系测试；不得先改 CSS 再补字符串断言。
- 输出基线表后继续 5B。

### 5B：AppShell 边界

- AppShell 三列改两列。
- Resize Handle 改绝对覆盖层。
- `SHELL_FRAME_HORIZONTAL_PX` 从旧 Gap+right Frame 16px 校准为新结构的 right Frame 8px；更新 pure metric 测试。
- Toast provincial offset 删除旧 Gap 8px，只使用 effective Sidebar width；保持 Settings/full legacy 规则。
- 保持拖拽数学、吸附、持久化与 collapse reasons。
- 验证 200/260/400、collapsed、dark。
- 本子任务完成后运行定向测试并人工验收侧栏；失败不得进入 5C。

### 5C：Header/Body Token 解耦

- 删除 split/expanded main 对 Header inset 的消费。
- 建立 Header-only safe inset 与 Body-owned Surface inset。
- 修复 collapsed + Preview Expanded 80px 空白。
- 保持 Header 52；Conversation Header→Surface 为 8px；Split 左右 Surface 与 Preview Expanded 描边 Surface 均使用各自独立的 0px Token 紧接 Header；Chat Surface 内部仍保留 8px 正文内距。
- Split Chat、Split Preview 和 Preview Expanded 共用 `8px` Body-owned Surface 底距；再与 Workspace 外框的 `8px` 底部 Frame 叠加，窗口到 Surface 底边总距离为 `16px`。

### 5D：稳定 Header Slots

- 收敛 `ContentHeader` 三套 return。
- 保持现有 ContentHeader 注册 API。
- 固定 workspace-actions 右锚点。
- 收敛 Sidebar restore 唯一位置。
- 验证 conversation/split/expanded 切换不跳。

### 5E：Search 与光学中心

- Search outer surface 改 32px。
- Search 改向左 overlay 展开，不参与主 Flex 宽度。
- 规范化 Header SVG 画布。
- 使用真实 macOS 截图标定 traffic lights；未测平台必须明确列为未验证。

### 5F：集成与文档同步

- 跑自动矩阵和手动矩阵。
- 复查 light/dark。
- Review `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需要更新；无行为/API 文档变化时记录“不需要”。
- 更新 OpenSpec tasks 和 `.cursor/rules/02-styles.mdc`。
- 停止并交付，禁止继续范围外美化。

## 14. 自动测试要求

### 14.1 禁止伪测试

以下测试不足以证明完成：

```text
只检查 class 字符串含 items-center
只检查源码含 y:28
只检查常量 52/32/8
只检查没有 translate-y
```

这些可以保留为静态守卫，但必须增加运行时几何关系验证。

### 14.2 必测关系

```text
abs(sidebar.right - workspace.left) <= 1
abs(scrollbar.right - sidebar.right) <= 1
resize handle 不增加 grid 总宽
effectiveMax 使用 horizontal Frame 8px，不再减旧中间 Gap
toast provincial offset == effectiveSidebarWidth

header.height == 52
abs(action.centerY - header.centerY) <= 1
searchSurface.height == 32

search open/closed:
abs(refresh.xBefore - refresh.xAfter) <= 1
abs(brain.xBefore - brain.xAfter) <= 1
abs(previewToggle.xBefore - previewToggle.xAfter) <= 1

collapsed + preview-expanded:
preview.left - workspace.left == 8 ± 1

split → preview-expanded:
abs(workspaceAction.rightBefore - workspaceAction.rightAfter) <= 1
```

### 14.3 定向命令

按实际存在的测试文件使用精确列表：

```bash
pnpm exec vitest run <精确测试文件>
pnpm exec eslint <本阶段实际修改的源码文件>
pnpm run typecheck
git diff --check
```

禁止安装依赖，禁止改构建/测试配置来迁就测试。

## 15. 用户手动验收

### 15.1 Sidebar

1. 展开 Sidebar，分别拖到 200、260、400。
2. 检查滚动条右侧没有 8px 结构空带。
3. 在滚动条出现时确认列表内容仍视觉居中。
4. 从 Sidebar/Workspace 边界拖动；不得抢占滚动条拖动。
5. 收起/恢复后回到上次 preferred width。

### 15.2 Header

1. conversation、split、preview-expanded 逐个切换。
2. 用截图横线检查标题、搜索、刷新、Brain、Tab、布局按钮中心。
3. 切换前后观察右上布局按钮不得左右跳。
4. Sidebar 收起/恢复时布局按钮仍固定在 Workspace 右侧。

### 15.3 Search

1. 打开搜索，外框高度应为 32px。
2. 刷新、Brain、Preview Toggle 不移动。
3. 标题允许被临时覆盖/裁剪，但不得把 Preview Tab 推走。
4. 验证 Enter、Shift+Enter、Escape、清空。

### 15.4 Preview

1. Split 30/50/70 三个比例检查 Header/Body 边界。
2. 展开 Preview，Sidebar 展开时正常 8px Surface inset。
3. 收起 Sidebar，Preview 左侧不得变成 80px。
4. 恢复 Split，比例、草稿、scrollTop、搜索状态不丢。

### 15.5 Theme / Window

```text
Light / Dark
1280 / 1440 / 1920
macOS DPR 2
Sidebar 200 / 260 / 400 / collapsed
Preview closed / split 30 / 50 / 70 / expanded
Search closed / open
```

Windows 未实测时不得声称已通过，只报告 DOM Header centerline 和保留窗口控件 reserve。

## 16. 停止条件

出现以下任一情况立即停止：

- 需要改 OverlayScrollbar primitive 才能制造 Sidebar 间距。
- 需要负 margin/translate 抵消 80px。
- Header 仍需三套 return 才能放置按钮。
- Search 打开必须改变 Header 高度。
- 需要修改依赖、lockfile、Vite/Electron 构建配置或 CI。
- 当前用户未提交修改与本阶段目标重叠且无法安全合并。
- 设计 MCP 给出与已批准 52/32/200–400 冲突的值。

## 17. 交付格式

```text
完成阶段：5（具体到 5A–5F）
实现的 Requirements：
修改文件：
保护的用户改动：
旧条款删除/迁移情况：
运行时几何 before/after：
测试命令与结果：
手动验收状态：
未验证平台/主题：
范围外问题：
是否存在临时兼容 alias及删除期限：
```

## 18. 给 Cursor 普通模型的启动提示词

```text
请在 /Users/tiancanyang/Documents/sto-claw/sto-claw 中严格执行：

1. AGENTS.md
2. docs/可拖拽侧边栏与三栏工作区框架-Cursor-T2开发文档.md
3. docs/workspace-shell-upgrade/05-工作区几何所有权与稳定顶栏收口-Cursor开发文档.md
4. openspec/changes/workspace-shell-architecture-upgrade/ 下的 proposal、design、specs、tasks

这是原工作区架构升级的 Stage 5 人工验收收口，不是新做一套页面。本文明确撤销的旧条款（Sidebar|8px|Workspace 三列真实 Gap、stoSplitShellInsetsClass 挂整个 main、三套 ContentHeader return）不得继续保留。

先执行 5A：读取当前 git status/diff，保护所有用户改动；读取最新 MCP 指定节点；使用运行时 getBoundingClientRect 输出 Sidebar/Workspace/Header/Search/Preview 基线；建立会失败的几何关系测试。不得一上来改 margin/padding。

随后严格按 5B→5C→5D→5E→5F 串行。AppShell 改为 Sidebar|Workspace 两列，8px Sidebar resize hit area 作为 Workspace 侧绝对 overlay，不占布局宽度；macOS safe inset 只属于 Header；ContentHeader 收敛为稳定槽位；Search 整体 32px并向左 overlay 展开；Preview Expanded Body 使用左右各 12px 的独立 Surface inset。

禁止：负 margin、逐按钮 translate-y、模式专用 magic number、setTimeout 重定位、重写 OverlayScrollbar、修改业务消息/文件预览、改依赖/lockfile/build/CI、git checkout/restore/reset、整仓格式化。

每个子任务完成后运行精确定向 vitest、eslint、typecheck、git diff --check。最后按本文第 17 节报告并停止，不得顺手做范围外视觉美化。
```
