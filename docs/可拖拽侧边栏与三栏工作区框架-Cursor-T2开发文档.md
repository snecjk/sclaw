# 可拖拽侧边栏与三栏工作区框架 · Cursor T2 开发文档

> 适用仓库：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 执行对象：Cursor Auto / 低能力模型
>
> 风险等级：Tier 2（应用壳层与多栏工作区局部重构）
>
> 文档状态：方案已确认；实施前必须按本文修订 OpenSpec，再按编号任务逐步执行
>
> 文档日期：2026-07-31

## 0. 文档用途

本文用于实现以下已经确认的整体目标：

1. 修复侧栏展开时主工作区最右侧 `8px` 壳层底色消失的问题。
2. 让左侧导航支持类似 Codex 桌面端的宽度拖拽：最小 `200px`、默认 `260px`、最大 `400px`。
3. 支持默认宽度吸附、最小宽度吸附、继续向左拖动收起、重新展开恢复宽度。
4. 统一 macOS 红黄绿按钮、侧栏按钮、工作区标题、页签和右侧操作按钮的水平中心线。
5. 去掉一级顶栏下方由多层 padding 叠加形成的过高空白。
6. 建立正式的预览状态：关闭、普通三栏、第三栏展开。
7. 普通三栏时让 Header 和 Body 共用同一条分栏线。
8. 去掉会话滚动条与第三栏之间当前人为制造的约 `20px` 空缝。
9. 保留并复用当前正在开发的应用级 Overlay Scrollbar，不另造滚动条。
10. 让 Toast、浮层和其他全局消费者读取真实有效侧栏宽度，不再硬编码 `72/260`。

本文不是让 Cursor 自由重新设计。本文已经给出固定结构、固定状态、固定顺序、文件边界和验收标准。Cursor 必须机械执行，不得擅自扩大范围。

---

## 1. Cursor 开始前强制协议

### 1.1 必须完整读取

按顺序完整读取：

1. 根目录 `AGENTS.md`。
2. `.cursor/rules/README.md`。
3. `.cursor/rules/00-workflow-and-risk.mdc`。
4. `.cursor/rules/05-engineering-guardrails.mdc`。
5. `.cursor/rules/01-code-rules.mdc`。
6. `.cursor/rules/02-styles.mdc`。
7. `docs/sto-design.md`。
8. `openspec/config.yaml`。
9. `openspec/examples/example-chat-typing-indicator/` 下全部示例文件。
10. `openspec/changes/chat-file-preview-enhancement/` 下全部文件。
11. `openspec/changes/overlay-scrollbar-surfaces/` 下全部文件。
12. `openspec/changes/unify-toast-and-chat-error-feedback/` 下全部文件。
13. 本文第 4 节列出的当前源码事实文件。

不得只读取本文后直接改代码。

### 1.2 开始前必须执行

```bash
git status --short
git diff --stat
git diff -- src/components/layout/MainLayout.tsx
git diff -- src/components/layout/Sidebar.tsx
git diff -- src/lib/surfaces.ts
git diff -- src/pages/Home/HomeMainConversation.tsx
git diff -- src/styles/globals.css
```

所有未提交修改均属于用户或此前任务。禁止覆盖、回退、整文件替换或通过格式化重写。

当前文档编写时已观察到 `MainLayout.tsx`、`Sidebar.tsx`、`surfaces.ts`、`HomeMainConversation.tsx`、`globals.css` 等文件存在 Overlay Scrollbar 相关未提交修改。执行时必须重新检查，以实时工作区为准。

### 1.3 第一个 patch 前必须输出 Preflight

```text
当前任务编号：
本次唯一目标：
本次允许修改文件：
当前用户未提交修改：
必须保留的现有行为：
本次涉及的 OpenSpec Requirement：
本次定向测试：
是否需要扩大范围：否（如果是，立即停止并报告）
```

### 1.4 强制执行节奏

- 一次只执行本文第 10 节中的一个编号任务。
- OpenSpec 任务完成前，不得修改 `src/`、`electron/` 或测试。
- 每个任务完成后立即检查该任务文件的 diff。
- 每个任务完成后立即运行该任务列出的定向测试。
- 完成当前任务后停止，不得自动进入下一任务。
- 不创建分支、不提交、不推送，除非用户另行明确要求。
- 不修改依赖、lockfile、构建配置、构建脚本或 CI/CD。
- 不运行 `pnpm install/add/update/remove`。
- 不运行带全仓自动修复的 lint。
- React 19 新代码不得默认新增 `useCallback`、`useMemo`、`React.memo`。
- 高频 pointermove/scroll 路径不得每帧 set React/Zustand state。

### 1.5 禁止命令和禁止手法

禁止：

```text
git checkout --
git restore
git reset
整文件覆盖
全仓格式化
pnpm install
pnpm update
pnpm run lint（除非明确确认不会全仓 auto-fix）
```

禁止为了“看起来对了”使用：

```text
负 margin 抵消布局错误
针对 expanded/collapsed 分别堆 p-2/pl-2/pr-2
在页面里写死 200/260/400
在 Toast 中写死 72/260
用 position: fixed 实现第三栏展开
用浏览器 Fullscreen API 实现第三栏展开
给分栏添加永久 20px 空白
让 Resize Handle 占据真实 Grid 宽度
每次 pointermove 写 Zustand/electron-store
为当前任务新增第三方拖拽或 scrollbar 依赖
```

---

## 2. 产品目标的准确解释

### 2.1 最终整体结构

```text
AppShell
├─ Sidebar：可调宽、可收起、保留用户偏好
├─ 8px Shell Gap：可见底色，同时承载 Sidebar Resize Handle
└─ WorkspaceShell
   ├─ 一级顶栏
   └─ WorkbenchGrid
      ├─ Conversation Pane
      ├─ 0px 逻辑分栏线 + 预览侧透明拖拽热区
      └─ Preview Pane
         ├─ 二级标题栏
         └─ 独立预览内容
```

视觉目标不是“三张卡片拼起来”，而是一张连续桌面工作台：

- 左侧导航属于应用外壳。
- 中间会话属于工作区画布。
- 右侧预览是工作区中的独立面板。
- 第三栏展开只接管工作区，不接管整个 Electron 窗口。

### 2.2 固定布局参数

| 项目 | 固定基线 |
| --- | --- |
| Shell 可见底色 | `8px` |
| Sidebar 最小宽度 | `200px` |
| Sidebar 默认宽度 | `260px` |
| Sidebar 最大宽度 | `400px` |
| Sidebar 继续向左收起阈值 | 从 `200px` 再向左约 `24px` |
| 一级工作区顶栏 | `56px` |
| 预览二级标题栏 | `48px` |
| 顶栏图标点击热区 | `32px` |
| 工作区内容 inset | `24px` |
| Split 逻辑中间轨道 | `0px` |
| Split Resize 命中宽度 | `8px`，完全放在预览侧 |
| Preview 默认比例 | `50%` |
| Preview 比例范围 | `30%–70%` |

如果真实设计源给出更精确标注，可以统一修改语义 Token；禁止在各组件分别写不同数值。

### 2.3 字体层级

| 内容 | 字号/行高 | 字重 |
| --- | --- | --- |
| 一级工作区标题 | `18/24px` | `600` |
| 预览面板标题 | `16/24px` | `600` |
| 页签、操作文字 | `14/20px` | `500` |
| 日期、元数据 | `14/20px` | `400` |
| Sidebar 账户名称 | `14/20px` | `600` |
| Sidebar 账户辅助信息 | `12/18px` | `400` |

禁止通过单独 `translate-y` 或 `top: 1px` 修正不同文本的垂直位置。应通过统一行高、容器高度和 `align-items:center` 建立中心线。

---

## 3. 必须支持的状态

### 3.1 Sidebar 状态

至少区分：

```ts
interface SidebarLayoutState {
  sidebarPreferredWidth: number;
  sidebarUserCollapsed: boolean;
  sidebarViewportCollapsed: boolean;
}
```

派生值：

```ts
effectiveCollapsed = sidebarUserCollapsed || sidebarViewportCollapsed;
effectiveWidth = effectiveCollapsed ? collapsedWidth : clampedPreferredWidth;
```

省区布局：

```text
collapsedWidth = 0px
```

完整 legacy 布局：

```text
collapsedWidth = 72px
```

本任务主验收对象是省区布局。完整布局不得回归，但除非设计明确更新，不擅自删除其 `72px` rail。

### 3.2 Sidebar 拖拽内部状态

拖动过程中必须同时维护：

```ts
rawWidth       // 鼠标真实位置对应宽度，可小于 200，用于判断收起阈值
renderedWidth  // 实际渲染宽度，限制在 200–effectiveMax
preDragWidth   // 开始拖拽前已提交宽度
```

不能只保存 clamp 后的 `renderedWidth`。否则宽度永远不会小于 `200px`，无法判断用户是否继续向左拖过 `24px`。

固定交互：

```text
自由区：200–400
接近 260：轻吸附
接近 200：轻吸附
rawWidth 在 176–200：仍显示 200，形成防误收起缓冲
rawWidth <= 176：收起 Sidebar
重新展开：恢复收起前已提交宽度
```

建议吸附滞回：

```text
默认值进入范围：±6px
默认值退出范围：±12px
最小值进入范围：±8px
```

禁止在同一个阈值上反复吸附/脱离造成抖动。

### 3.3 Preview 状态

必须使用：

```ts
type PreviewMode = 'closed' | 'split' | 'expanded';
```

不得继续以单一 `showPreviewPanel: boolean` 作为完整状态。

状态语义：

| 模式 | Conversation | Preview | Split Handle | Header |
| --- | --- | --- | --- | --- |
| `closed` | 占满工作区 | 隐藏 | 隐藏 | 普通会话模板 |
| `split` | 显示 | 显示 | 显示 | 会话列 + 预览列模板 |
| `expanded` | 保持挂载但隐藏 | 占满工作区 | 隐藏 | 菜单/页签/恢复模板 |

`split → expanded → split` 必须恢复展开前的 `previewSplitPercent`。

Conversation 保持挂载是为了保留：

- 输入草稿。
- 消息滚动位置。
- streaming/run 状态。
- 搜索状态。
- Jump to latest 状态。

禁止通过条件渲染卸载整个 Conversation Pane。可以用布局 class 隐藏，并同步 `aria-hidden`/`inert`，但 React 子树必须保留。

---

## 4. 当前代码事实

Cursor 必须以执行时真实代码为准，并重新核对以下事实。

### 4.1 AppShell

文件：

```text
src/components/layout/MainLayout.tsx
src/lib/surfaces.ts
```

当前省区结构仍是 flex：

```text
body flex
├─ Sidebar
└─ MainCardWrap
```

当前未提交版本的 `stoMainCardWrapClass()` 展开态是 `pt-2 pb-2`，没有固定右侧 `8px`，也没有独立的 Sidebar/Main `8px` Grid Track。

结论：该函数的 collapsed 条件 padding 不是最终结构，必须被显式 AppShell Grid 取代。

### 4.2 Sidebar

文件：

```text
src/components/layout/Sidebar.tsx
src/components/layout/sidebar-brand-header.tsx
src/components/layout/sidebar-header-toggle.tsx
src/stores/settings.ts
electron/utils/store.ts
```

当前 Sidebar：

- 展开宽度来自 `--sto-sidebar-w-expanded: 260px`。
- 完整布局收起宽度来自 `--sto-sidebar-w-collapsed: 72px`。
- 省区收起通过 `w-0` 完全隐藏。
- 没有 preferred width。
- `setSidebarCollapsed` 只写 Renderer Zustand，没有写 Host Store。
- Main Store 又存在 `sidebarCollapsed`，初始化时可能覆盖 Renderer 状态。

### 4.3 三栏 Grid

文件：

```text
src/lib/surfaces.ts
src/components/layout/ContentHeader.tsx
src/components/layout/content-header-context.tsx
src/pages/Home/HomeMainConversation.tsx
src/pages/Chat/index.tsx
```

可保留：

```text
grid-template-columns: minmax(0,1fr) 0px var(--sto-split-preview-col)
```

必须替换：

```text
--sto-split-preview-inset-x: 10px
chat body padding-right: 10px
preview body padding-left: 10px
handle translate-x: 10px
```

这些旧规则共同形成滚动条到预览面板的约 `20px` 空缝。

### 4.4 Preview Resize Hook

文件：

```text
src/hooks/use-split-panel-resize.ts
src/components/layout/split-panel-resize-handle.tsx
```

当前 Hook 已有 Pointer Capture、RAF、cancel/blur/lost capture/unmount 清理和松手提交。必须复用，不得为了 Sidebar 拖拽把它改造成未经验证的“万能 Resize Hook”。

Sidebar 新建专用 Hook，只复用交互模式和纯数学帮助函数，不强行合并两个领域。

### 4.5 Preview Open State

文件：

```text
src/hooks/use-chat-preview-panel.ts
```

当前只有 `showPreviewPanel: boolean`。必须升级为 PreviewMode，但保留现有文件、tab、dismiss、active path、workflow preview 行为。

### 4.6 Overlay Scrollbar WIP

文件：

```text
src/components/ui/overlay-scrollbar.tsx
src/hooks/use-overlay-scrollbar.ts
src/lib/overlay-scrollbar-metrics.ts
src/pages/Home/HomeMainConversation.tsx
src/components/layout/Sidebar.tsx
src/components/sclaw-browser/SclawBrowserEmbedChat.tsx
src/styles/globals.css
```

当前 Overlay change 属于用户已有工作，必须保护并复用。

本任务只定义它与新布局的边界：

```text
Workbench/Chat Pane 提供贴边定位 host
OverlayScrollbar 继续负责 thumb 几何、活动态和拖动
```

不得复制 OverlayScrollbar，也不得重新实现 scroll activity timer。

### 4.7 Toast

文件：

```text
src/App.tsx
```

当前直接按 `collapsed ? 72 : 260` 计算 Toast 中心。加入可调宽后必须改为读取 AppShell 导出的 effective sidebar width。

---

## 5. 最终 DOM 与 CSS 契约

### 5.1 AppShell DOM

目标结构等价于：

```tsx
<div data-app-shell="provincial">
  <div className="app-shell-grid">
    <Sidebar />
    <SidebarResizeHandle />
    <div className="workspace-wrap">
      <main className="workspace-shell">
        <ContentHeader />
        <Workbench />
      </main>
    </div>
  </div>
</div>
```

目标 Grid：

```css
grid-template-columns:
  var(--sto-sidebar-effective-w)
  var(--sto-shell-card-gap)
  minmax(0, 1fr);
```

固定规则：

- Sidebar 占第一列并保持全高。
- 第二列固定 `8px`，既是壳层底色，也是 Sidebar Resize Handle 所在区域。
- Workspace Wrapper 占第三列。
- Workspace Wrapper 自己承担 `padding-top/right/bottom: 8px`。
- Workspace 不再根据 collapsed 切换 padding。
- collapsed 时第一列变为 `0px`，第二列自然成为左侧 `8px`。
- Sidebar Resize Handle 不得额外占据第四列。

### 5.2 Workspace Grid

```css
grid-template-rows:
  var(--sto-content-header-h)
  minmax(0, 1fr);
```

一级 Header 采用 `56px`。正文紧贴 Header 下沿，不再由多层组件叠加顶部 padding。

### 5.3 Split Grid

普通三栏：

```css
grid-template-columns:
  minmax(0, 1fr)
  0px
  var(--sto-split-preview-col, 50%);
```

必须满足：

```text
chat pane right
= overlay scrollbar rail right
= logical split boundary
= preview panel left border
```

禁止存在结构性水平 gap。

### 5.4 Split Resize Handle

固定要求：

- 逻辑 Grid middle track 仍是 `0px`。
- Handle 命中宽度 `8px`。
- Handle 完全位于预览侧，避免覆盖 Chat OverlayScrollbar。
- Handle 只位于 Body Row，不再 `row-span-2` 穿过 Header。
- 默认透明。
- hover、dragging、focus-visible 时显示提示线。
- 提示线不参与布局。
- expanded/closed 模式不渲染 Handle。

### 5.5 Header Grid

普通会话：

```text
[Sidebar expand + title] [flex drag region] [conversation actions] [window reserve]
```

普通三栏：

```text
[title ........ conversation actions] [0px boundary] [preview tabs .... preview actions]
```

第三栏展开：

```text
[menu + preview tabs ........................] [restore + window controls]
```

Header 与 Body 必须读取同一个 `--sto-split-preview-col`。

Header 内部 padding 不得复用 split visual gap。必须拆分语义变量，例如：

```text
--sto-split-visual-gap: 0px
--sto-split-handle-hit-w: 8px
--sto-header-section-pad: 12px
--sto-workspace-content-inset: 24px
```

### 5.6 Conversation 与 Preview

Conversation：

- 是工作区画布，不再套一层制造右侧缝隙的独立圆角/阴影外卡。
- 消息阅读轨可以继续限宽和居中。
- 阅读内容的 `24px` padding 在内容轨内部。
- OverlayScrollbar 挂在完整 Chat Pane 的右边缘。
- 输入框只属于 Conversation Pane，左右和底部使用内容 inset。

Preview：

- 保留独立边框、圆角、二级标题栏和滚动内容。
- split 模式左边缘直接位于逻辑分栏线，不增加左侧 outer gap。
- 右侧和底部保留设计稿要求的内容 inset。
- expanded 模式可以按设计稿增加自身左侧 inset，但不得改变 AppShell 的 `8px` 外壳。

---

## 6. 状态与持久化契约

### 6.1 Renderer State

在现有 Settings Store 中增加用户布局偏好，但不把拖动瞬时 rawWidth 写入持久化 Store。

建议字段：

```ts
sidebarPreferredWidth: number;
sidebarCollapsed: boolean;
previewSplitPercent: number;
```

响应式临时收起可由 AppShell 本地派生，不持久化：

```ts
sidebarViewportCollapsed: boolean;
```

### 6.2 Main Store

`electron/utils/store.ts` 至少增加：

```ts
sidebarPreferredWidth: number;
```

并修复现有 `sidebarCollapsed` setter，使其通过 Host API 持久化。

固定事实来源：

```text
运行时即时状态：Zustand
跨启动持久化权威：electron-store
Host 不可达回退：Zustand persist
```

禁止 Renderer 组件直接调用 `window.electron.ipcRenderer.invoke`。继续使用现有 host-api/api-client 入口。

### 6.3 Commit 时机

```text
pointermove：只更新 CSS 变量
pointerup：提交一次 Zustand + Host
pointercancel/blur：恢复拖动前已提交值
collapse threshold：提交 collapsed，并保留 preferred width
```

### 6.4 Persist Migration

Settings Zustand 当前版本为 `1`。增加字段时必须：

- 提升 persist version。
- 为旧用户迁移 `sidebarPreferredWidth = 260`。
- clamp 非法旧值到 `200–400`。
- 不删除未知的已有设置字段。

Electron Store 使用 defaults 补充新字段，不修改 electron-store 依赖或配置。

---

## 7. 响应式契约

Electron 当前最小窗口宽度为 `960px`。三栏不能只按百分比无限压缩。

处理顺序固定：

1. 根据 preview mode 计算 Workspace 最低可用宽度。
2. 计算 `effectiveSidebarMax = min(400, viewport - shell - workspaceMin)`。
3. 如果 `effectiveSidebarMax >= 200`，Sidebar 在 `200–effectiveSidebarMax` 内拖动。
4. 如果连 `200px` Sidebar 都放不下，设置 `sidebarViewportCollapsed = true`。
5. 窗口重新变宽后取消临时收起，恢复 `sidebarPreferredWidth`。
6. 不改变 `sidebarUserCollapsed`。
7. 不改变 `previewSplitPercent`。

禁止在窄窗口中通过文本溢出、隐藏 Toolbar 或让 Preview 小于最低可用宽度来掩盖问题。

---

## 8. OpenSpec 处理规则

### 8.1 新建主 Change

建议名称：

```text
openspec/changes/resizable-sidebar-workspace-shell/
```

必须按顺序创建：

```text
proposal.md
design.md
specs/
tasks.md
apply
```

建议 New Capabilities：

```text
resizable-sidebar-shell
workspace-layout-modes
```

proposal 必须明确 dark mode、macOS/Windows、响应式、未提交 Overlay WIP 保护。

### 8.2 修订活动的 Chat Preview Change

当前：

```text
openspec/changes/chat-file-preview-enhancement/
```

其规范仍要求 `10px shared inset`。最新设计已经否决该要求。

必须先修改该活动 change 的 design/spec/tasks：

- 删除左右各 `10px` 的视觉空缝要求。
- 改成 `0px` visual seam。
- Handle 改为预览侧 `8px` overlay hit area。
- Handle 只覆盖 Body Row。
- Header padding 与 split gap 解耦。
- 增加 split/expanded 恢复要求或引用新 workspace capability。
- 更新原有断言 10px/row-span-2 的任务和测试说明。

禁止让两个活动 OpenSpec 同时对同一条 split seam 规定不同数值。

### 8.3 Overlay Change 作为依赖

当前：

```text
openspec/changes/overlay-scrollbar-surfaces/
```

不重写其 Overlay 行为。新 change 只声明：

- AppShell/Conversation Pane 提供正确的定位边界。
- OverlayScrollbar 负责 thumb 行为。
- 当前用户未提交改动必须保留。

如果新 AppShell 使 Overlay change 中的 Home full-bleed 表述失效，只允许做最小文档同步，不得重写 Overlay 组件。

### 8.4 Toast Change

当前：

```text
openspec/changes/unify-toast-and-chat-error-feedback/
```

其现有规格写死了 collapsed `72px`。必须将其修订为：

```text
Toast 使用 AppShell 的 effective sidebar width 与 shell gap 计算主工作区中心
```

不得在新 change 再复制一份相互冲突的 notification capability。

---

## 9. 文件职责与预计修改

### 9.1 建议新增

```text
src/lib/app-shell-metrics.ts
src/lib/sidebar-resize-metrics.ts
src/hooks/use-sidebar-resize.ts
src/components/layout/sidebar-resize-handle.tsx
tests/unit/app-shell-metrics.test.ts
tests/unit/sidebar-resize-metrics.test.ts
```

职责：

- `app-shell-metrics.ts`：纯函数计算 effective width、dynamic max、Toast anchor 所需值。
- `sidebar-resize-metrics.ts`：纯函数 clamp、snap、hysteresis、collapse threshold。
- `use-sidebar-resize.ts`：Pointer 生命周期和 RAF DOM 写入。
- `sidebar-resize-handle.tsx`：separator 语义与键盘操作。

禁止把全部逻辑塞进 `Sidebar.tsx`。

### 9.2 预计修改

```text
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/components/layout/ContentHeader.tsx
src/components/layout/content-header-context.tsx
src/components/layout/sidebar-brand-header.tsx
src/components/layout/app-shell-chrome-overlay.tsx
src/lib/surfaces.ts
src/styles/globals.css
src/stores/settings.ts
electron/utils/store.ts
electron/main/index.ts
src/App.tsx
src/hooks/use-chat-preview-panel.ts
src/components/layout/split-panel-resize-handle.tsx
src/pages/Home/HomeMainConversation.tsx
src/pages/Chat/index.tsx（只做共享契约兼容，不扩大旧路由业务）
tests/unit/split-panel-layout.test.tsx
tests/unit/stores.test.ts
```

### 9.3 默认禁止修改

除非某个任务明确列入白名单：

```text
package.json
pnpm-lock.yaml
vite.config.ts
vitest.config.ts
electron-builder.*
scripts/
.github/workflows/
Gateway/通信链路
业务 API
消息发送与接收逻辑
```

---

## 10. 分阶段开发任务

### 任务 0：只做现场审计

允许修改文件：无。

执行：

1. 重新读取 git status/diff。
2. 列出 Overlay WIP 修改文件。
3. 列出本任务重叠文件。
4. 确认实际运行入口是 Home、Task Detail 还是旧 Chat。
5. 确认当前 active OpenSpec 状态。

停止条件：任何真实代码事实与本文不同，先报告差异，不修改代码。

### 任务 1：OpenSpec

只允许修改：

```text
openspec/changes/resizable-sidebar-workspace-shell/**
openspec/changes/chat-file-preview-enhancement/**
openspec/changes/unify-toast-and-chat-error-feedback/**
```

执行：

1. 修订旧 10px split seam 规范。
2. 修订 Toast 硬编码宽度规范。
3. 创建新 change 的 proposal。
4. 创建 design，记录每个决策的 rationale 和 alternative。
5. 创建两个 capability spec。
6. 创建带 Requirement 名称引用的 tasks。
7. 覆盖 light/dark、macOS/Windows、960/1280/1920。

完成后停止，不改源码。

### 任务 2：纯几何与状态数学

允许修改：

```text
src/lib/app-shell-metrics.ts
src/lib/sidebar-resize-metrics.ts
tests/unit/app-shell-metrics.test.ts
tests/unit/sidebar-resize-metrics.test.ts
```

实现：

- clamp 200–400。
- dynamic max。
- default/min snap hysteresis。
- rawWidth collapse threshold。
- preferred/effective width。
- viewport constrained collapse。
- Toast anchor 输入值。

只写纯函数，不接 React，不改 UI。

### 任务 3：AppShell Grid 与 8px 不变量

允许修改：

```text
src/components/layout/MainLayout.tsx
src/lib/surfaces.ts
src/styles/globals.css
tests/unit/app-shell-layout.test.tsx（可新增）
```

实现：

1. 省区 body 改为三列 Grid。
2. 第二列固定 8px。
3. Workspace Wrapper 固定 top/right/bottom 8px。
4. 删除 collapsed 条件 padding 所承担的几何责任。
5. 保持 Settings 特殊分支行为不变。
6. 不接 Sidebar 拖拽。

验收：先用固定 260/0 验证展开和收起两种 8px。

### 任务 4：Sidebar 拖拽 UI

允许修改：

```text
src/hooks/use-sidebar-resize.ts
src/components/layout/sidebar-resize-handle.tsx
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/lib/surfaces.ts
tests/unit/use-sidebar-resize.test.tsx（可新增）
```

实现：

- 使用 AppShell 第二列作为命中区域。
- Pointer Capture + RAF。
- 200/260/400。
- 吸附滞回。
- 24px 收起阈值。
- cancel/blur/lost capture/unmount 清理。
- 拖动期间关闭 width transition。
- separator aria 和键盘操作。

本任务不得接 Host 持久化。

### 任务 5：Sidebar 持久化与响应式

允许修改：

```text
src/stores/settings.ts
electron/utils/store.ts
src/components/layout/MainLayout.tsx
src/App.tsx
tests/unit/stores.test.ts
tests/unit/app-shell-metrics.test.ts
```

实现：

- sidebarPreferredWidth。
- sidebarCollapsed Host 持久化。
- Zustand migrate。
- viewport constrained collapse。
- Toast 使用 effective width。
- 窗口恢复时恢复用户宽度。

不得修改 Electron API 边界模式；继续使用现有 host-api 路由。

### 任务 6：Header 模式与顶部中心线

允许修改：

```text
src/components/layout/ContentHeader.tsx
src/components/layout/content-header-context.tsx
src/components/layout/sidebar-brand-header.tsx
src/components/layout/app-shell-chrome-overlay.tsx
src/lib/surfaces.ts
src/styles/globals.css
electron/main/index.ts
tests/unit/content-header-layout.test.tsx（可新增）
```

实现：

1. boolean `isSplitLayout` 升级为 layoutMode。
2. 一级 Header 使用 56px Token。
3. 三种 Header 模板。
4. 图标点击区 32px。
5. 统一标题、页签、操作中心线。
6. 校准 Sidebar Toggle、Windows 控件和 macOS traffic lights。
7. 确保 drag-region/no-drag 正确。

禁止通过单个元素 translate-y 补视觉。

### 任务 7：三栏零缝隙

允许修改：

```text
src/lib/surfaces.ts
src/components/layout/split-panel-resize-handle.tsx
src/pages/Home/HomeMainConversation.tsx
src/pages/Chat/index.tsx
tests/unit/split-panel-layout.test.tsx
```

实现：

- 删除 chat right 10px。
- 删除 preview left 10px。
- Handle 8px 且位于预览侧。
- Handle 只占 Body Row。
- Header padding 使用独立变量。
- 保持 Grid middle track 0px。
- OverlayScrollbar rail 与预览左边框同坐标。
- 删除制造独立卡片缝隙的 Conversation 外壳视觉。

必须更新旧测试中对 10px、52px、row-span-2 的断言。

### 任务 8：PreviewMode 与第三栏展开

允许修改：

```text
src/hooks/use-chat-preview-panel.ts
src/components/layout/content-header-context.tsx
src/components/layout/ContentHeader.tsx
src/pages/Home/HomeMainConversation.tsx
src/pages/Chat/index.tsx
src/lib/surfaces.ts
tests/unit/chat-preview-mode.test.tsx（可新增）
```

实现：

- closed/split/expanded。
- split percent 恢复。
- expanded 隐藏但不卸载 Conversation。
- expanded 禁用 Handle。
- expanded Header 模板。
- restore 按钮。
- session 切换时回到 closed，保持现有产品语义。

禁止调用 DOM Fullscreen API。

### 任务 9：正文顶部与设计密度

允许修改：

```text
src/lib/surfaces.ts
src/pages/Home/HomeMainConversation.tsx
src/pages/Chat/index.tsx
src/components/sclaw-browser/SclawBrowserEmbedChat.tsx（仅在确有差异时）
.cursor/rules/02-styles.mdc
```

实现：

- 一级 Header 下正文立即开始。
- Primary Conversation 顶部 padding 为 0。
- 底部保留必要 composer 间距。
- Embed 如果有自己的 Header，保留独立 py，不被 Primary 规则误伤。
- 内容 inset 统一为明确 Token。
- 字体层级对齐第 2.3 节。

不要依赖 Tailwind `py-4 + pt-0` 冲突覆盖；应通过结构化 variant 选择唯一 class。

### 任务 10：最终回归与文档

允许修改：

```text
相关测试
README.md
README.zh-CN.md
README.ja-JP.md
.cursor/rules/02-styles.mdc
对应 OpenSpec tasks.md
```

执行：

- 定向 Vitest。
- Typecheck。
- 定向 ESLint，只检查 touched files；禁止全仓 auto-fix。
- `git diff --check`。
- 手工视觉矩阵。
- Review 三份 README，只有行为/接口需要说明时才修改。
- OpenSpec tasks 根据真实完成情况打勾，不得虚报。

---

## 11. 测试要求

### 11.1 纯逻辑测试

必须覆盖：

- `199 → 200` clamp。
- `401 → 400` clamp。
- 260 进入和退出吸附。
- 200 进入吸附。
- rawWidth `177` 不收起。
- rawWidth `176` 收起。
- 拖动收起保留 preDragWidth。
- 动态最大宽度小于 preferredWidth。
- 窗口恢复后重新使用 preferredWidth。
- 用户主动 collapsed 不被响应式恢复覆盖。

### 11.2 DOM/结构测试

必须覆盖：

- AppShell 是 sidebar/gap/workspace 三列。
- 8px gap 不依赖 collapsed 条件 padding。
- Split middle track 是 0px。
- Chat/Preview 不再共享 10px inset。
- Handle 位于 Body Row。
- Handle 具有 separator aria。
- expanded 模式不显示 Handle。
- Conversation 在 expanded 时仍挂载。
- Header 三种模板。
- Toast 不包含硬编码 72/260。

### 11.3 手工视觉矩阵

Sidebar：

```text
200 / 260 / 400 / user collapsed / viewport collapsed
```

Preview：

```text
closed / split 30 / split 50 / split 70 / expanded / restore
```

窗口：

```text
960 / 1280 / 1920
```

平台与主题：

```text
macOS light/dark
Windows light/dark
```

页面：

```text
Home
Task Detail
Workflow
Browser Embed
App Plaza
Settings（只验证不回归）
```

### 11.4 几何验收

必须满足：

```text
主卡片 top/right/bottom gutter = 8px
Sidebar 展开时 sidebar/main gutter = 8px
Sidebar 收起时 main left gutter = 8px
Header 控件中心线误差 <= 1px
Conversation/Preview 正文起点误差 <= 1px
previewLeft - chatScrollbarRailRight = 0px
无横向 scrollbar
无永久可见 split gutter
```

### 11.5 交互验收

必须满足：

- 快速拖动 Sidebar 不丢失 pointer。
- 快速拖动 Preview 不丢失 pointer。
- pointercancel/blur/unmount 后 cursor 和 userSelect 恢复。
- Sidebar 拖动期间不出现 transition 追赶。
- Preview Handle 不阻断 OverlayScrollbar hover/drag。
- expanded/restore 不丢草稿和 scrollTop。
- 应用重启后恢复 Sidebar preferred width 和用户 collapsed 状态。
- 窗口变窄/变宽不覆盖用户偏好。

---

## 12. Stop Rules

出现以下任一情况立即停止，不继续补丁：

1. 需要修改 package、lockfile、构建配置或脚本。
2. patch 会覆盖当前 OverlayScrollbar 未提交改动。
3. 发现实际运行入口与本文不同且会改变文件范围。
4. 需要同时修改两个 active OpenSpec 中互相冲突的同名 Requirement，但尚未确定唯一归属。
5. 需要为实现第三栏展开卸载 Conversation 子树。
6. 需要使用负 margin、fixed overlay 或 Fullscreen API 才能对齐设计。
7. Resize Handle 与 OverlayScrollbar 无法同时交互，且需要改变 OverlayScrollbar 公共协议。
8. 新增字段会被 Host init 覆盖，但持久化迁移尚未设计完成。
9. 需要改变 Settings 特殊路由、Gateway、消息发送或业务 API。
10. 定向测试失败原因来自任务白名单外文件。

停止时必须报告：

```text
阻塞任务编号：
阻塞文件：
当前代码事实：
与文档冲突点：
已完成的安全部分：
需要用户确认的最小问题：
```

---

## 13. 每个任务的交付格式

Cursor 完成单个任务后必须只报告：

```text
完成任务：
修改文件：
复用并保护的用户改动：
实现的 Requirement：
运行的定向测试及结果：
未验证项：
发现但未处理的范围外问题：
下一任务编号（不自动执行）：
```

不得用“整体完成”“全部验证通过”描述尚未完成的后续任务。

---

## 14. 最终完成定义

只有同时满足以下条件，整个 T2 才算完成：

1. 新 OpenSpec artifacts 完整且无冲突规范。
2. 旧 Chat Preview 10px shared inset 规范已修订。
3. Toast 规范不再写死 72/260。
4. AppShell 8px 几何不依赖 collapsed 条件 padding。
5. Sidebar 200/260/400、吸附、阈值收起、恢复和持久化全部工作。
6. Preview closed/split/expanded 全部工作。
7. Header 与 Body 共用 split boundary。
8. 滚动条轨道与第三栏边框之间没有结构性间距。
9. 顶部中心线和正文顶部留白符合设计稿。
10. OverlayScrollbar 现有行为没有回归或被复制。
11. light/dark、macOS/Windows、窄/中/宽窗口完成验收。
12. 定向测试、typecheck、diff check 通过。
13. 用户原有未提交修改全部保留。

最终产品效果应为：左侧导航可稳定拖拽和收起，中间会话自适应，右侧预览可分栏和工作区内展开；所有状态共享统一的 8px 外壳、统一顶栏、零缝隙分栏和可恢复布局偏好。
