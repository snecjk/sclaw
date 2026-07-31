# 可拖拽侧边栏与三栏工作区框架 · Cursor T2 开发文档

> 适用仓库：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 执行对象：Cursor Auto / 低能力模型
>
> 风险等级：Tier 2（应用壳层与多栏工作区局部重构）
>
> 文档状态：整体结构升级方案 v2；已将 Sidebar 展开、用户收起、响应式收起统一纳入全局状态矩阵；实施前必须按本文修订 OpenSpec，再按编号任务逐步执行
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
11. 重建浅色/深色一致的表面层级：Sidebar 与 Shell Gap 属于同一个基础平面，Workspace 和 Panel 逐层抬升；不要求颜色完全相同，但必须避免深色下出现彼此无关的蓝绿侧栏与蓝紫主卡片。

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
为了消除割裂直接把 Sidebar、Workspace、Preview 全部改成同一个颜色
在 Sidebar、MainLayout、Preview 页面分别硬编码 dark 背景色
只加深黑色阴影来表达深色层级
通过透明度叠加碰巧调出某一张截图的颜色
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

### 2.4 浅色/深色表面层级

本任务追求的是“同一套层级语义”，不是“所有区域使用同一个颜色”。

固定层级：

```text
L0 Window / Shell Base
├─ 页面外壳背景
├─ Sidebar 背景
└─ 8px Shell Gap

L1 Workspace Surface
└─ 主工作区大卡片

L2 Panel Surface
├─ 右侧 Preview Panel
├─ Composer
└─ 内容卡片

L3 Floating Surface
├─ Toast
├─ Popover
└─ Modal
```

浅色现状已经接近正确语义：

```text
L0 page/sidebar/gap = #EDEDED
L1 workspace = #FAFAFA
```

深色必须表达同样关系：

- Page、Sidebar、Shell Gap 必须共享同一个 L0 基础平面 Token，或至少使用肉眼不可分离的同色相/同明度关系。
- Workspace 使用同一冷中性色相体系中的略高明度，表达 L1，而不是切换到另一套明显色相。
- Preview、Composer、内容卡片属于 L2，明度可再轻微提高。
- Toast、Popover、Modal 属于 L3，继续使用既有 floating/elevation 语义，不在本任务重新设计全部浮层。
- 深色层级优先通过“同色相明度阶梯 + 极弱边缘高光 + 轻阴影”表达，不依赖重黑阴影。

建议的初始关系，不是允许页面硬编码的最终值：

```text
L0 Shell/Sidebar：约 220 24% 9%
L1 Workspace：约 220 22% 11%–12%
L2 Panel：约 220 18% 14%–16%
```

实现时必须落为语义 Token，例如：

```text
--sto-shell-bg
--sto-sidebar-bg: var(--sto-shell-bg)
--sto-workspace-bg
--sto-panel-bg
--sto-surface-edge
--sto-workspace-shadow
```

禁止把上述示例 HSL 分别复制到 Sidebar、Main Card 和 Preview class。具体数值只能在主题 Token 定义处出现一次。

深色阴影要求：

- 不沿用当前明显放大的纯黑分离感作为唯一层级手段。
- Workspace 可以使用低透明度短阴影和极弱浅色边缘。
- 边缘用于解释曲面，不得形成常驻高亮描边。
- dark shadow 的视觉强度应与 light mode 的“轻微抬升”语义一致，而不是让 Workspace 成为独立浮岛。

结构优先级：必须先完成第 5.1 节的 8px Shell Grid，再调 Surface Token。没有稳定 Gap 时，不允许用颜色掩盖直接贴接和圆角黑楔。

### 2.5 为什么这些现象是同一个框架问题

截图中的右侧 8px 消失、收起后才正常、深色侧栏割裂、顶部过高、三栏滚动条留缝，并不是五个互不相关的 CSS 小问题。当前结构有五类所有权混杂：

| 根因 | 当前表现 | 局部补丁为何会失败 | 本方案的唯一归属 |
| --- | --- | --- | --- |
| 外壳几何由条件 padding 拼接 | 展开缺右 8px，收起改成 body 四边 p-2 才正常 | 修展开会破坏收起，修收起又会重复 padding | AppShell 三列 Grid + 固定 Frame |
| 收起原因共用一个 `sidebarCollapsed` | 用户、Workflow 临时状态互相保存/恢复，未来 viewport 还会加入竞争 | 每个组件读一个 bool，无法知道该不该恢复 | AppShellLayoutSnapshot + collapse reasons |
| Surface 由页面和组件分别定色 | light 像一体，dark 出现蓝绿 Sidebar、蓝紫 Workspace、黑楔 | 调一个颜色只会把割裂转移到 Gap、圆角或收起态 | L0/L1/L2 语义 Token 与所有权 |
| Header 与 Body 各自判断 split | 标题、页签、按钮中心线和三栏边界不一致 | translate/padding 只能对齐某个窗口宽度 | `layoutMode` + 共享 split boundary |
| 内容 inset、Panel seam、Scrollbar rail 混用 | 顶部空白叠加，滚动条到第三栏出现约 20px 间距 | 删除某个 padding 容易伤害阅读轨或 Embed | Shell/Content/Header/Handle 四类独立 Token |

因此实施顺序不能交换：

```text
状态与尺寸纯函数
→ AppShell 几何和 Surface 所有权
→ Sidebar 拖拽及三类收起原因
→ Header/Workbench 布局模式
→ Split/Preview/Scrollbar
→ 内容密度
→ light/dark Token 数值校准
```

如果在前一步没有稳定时进入后一步，Cursor 必须停止并回退，不得用颜色、margin、伪元素或额外条件 class 遮盖。

---

## 3. 必须支持的状态

### 3.1 Sidebar 状态

至少区分：

```ts
interface SidebarLayoutState {
  sidebarPreferredWidth: number;
  sidebarUserCollapsed: boolean;
  sidebarViewportCollapsed: boolean;
  sidebarContextCollapsed: boolean;
}
```

派生值：

```ts
effectiveCollapsed =
  sidebarUserCollapsed ||
  sidebarViewportCollapsed ||
  sidebarContextCollapsed;
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

字段语义必须分离：

- 现有持久化字段 `sidebarCollapsed` 迁移后只代表 `sidebarUserCollapsed`；可以暂时保留存储键名兼容旧数据，但代码语义不得再把它当作“任何原因造成的收起”。
- `sidebarViewportCollapsed` 是窗口约束派生状态，不持久化。
- `sidebarContextCollapsed` 是 Workflow editor 等产品上下文临时要求，不持久化。
- 退出 Workflow editor 只撤销 context 原因，不能用 ref 覆盖用户在此期间的真实偏好。
- 三种原因最终都进入同一个 `effectiveCollapsed`，不得分别驱动 Sidebar、Header、Toast 或 Surface。

所有消费者读取一个只读快照，不直接读取三种原因后自行 OR：

```ts
interface AppShellLayoutSnapshot {
  sidebarPreferredWidth: number;
  effectiveSidebarWidth: number;
  effectiveSidebarMax: number;
  effectiveCollapsed: boolean;
  collapseReasons: {
    user: boolean;
    viewport: boolean;
    context: boolean;
  };
  canUserRestoreSidebar: boolean;
  previewMode: PreviewMode;
  previewSplitPercent: number;
}
```

建议由 `AppShellLayoutProvider` 统一生成该快照并设置根节点 CSS 变量/属性。CSS 只允许依赖 `data-sidebar-collapsed`，不得根据 `user/viewport/context` 分别换布局或颜色。`collapseReasons` 只用于恢复策略、控件能力、测试和调试。

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

### 3.4 全局正交状态矩阵

Sidebar 状态、Preview 状态和 Theme 是三条正交状态轴。实现不得只验证“侧栏展开 + 三栏打开 + 浅色”这一种组合。

```text
Sidebar axis
├─ expanded：200 / 260 / 400 / dynamic max
├─ user collapsed：用户主动收起
├─ viewport collapsed：空间不足临时收起
└─ context collapsed：Workflow editor 等上下文临时收起

Preview axis
├─ closed
├─ split：30 / 50 / 70
└─ expanded

Theme axis
├─ light
└─ dark
```

所有组合共享同一个 Surface 层级契约：

| Sidebar 状态 | 第一列 | 8px Gap | Workspace | Surface 解释 |
| --- | --- | --- | --- | --- |
| expanded | L0 Sidebar | L0 | L1 | Sidebar 与 Gap 连成底盘，Workspace 轻抬升 |
| user collapsed（省区） | `0px` | L0 | L1 | L0 变成 Workspace 左侧外框，不出现异色楔形 |
| viewport collapsed（省区） | `0px` | L0 | L1 | 与用户收起视觉完全一致，只是状态来源不同 |
| context collapsed（省区） | `0px` | L0 | L1 | 与其他收起视觉完全一致，只由上下文进入/退出 |
| collapsed（full legacy） | `72px` L0 rail | L0/既有分隔 | L1 | 保留 legacy rail，不改为省区 `0px` |

Preview `closed/split/expanded` 只能改变 L1 内部的 Workbench 排布，不能改变 AppShell 的 L0/L1 关系。

特别要求：

- 用户收起、响应式收起和上下文收起必须使用同一个 `effectiveCollapsed` 布局结果。
- 根节点 `data-sidebar-collapsed` 必须反映 `effectiveCollapsed`，不能只反映持久化的 `sidebarCollapsed`。
- macOS traffic-light 避让、Header 左侧 padding、Toast anchor、Resize Handle 显隐都必须读取 effective 状态。
- 收起动画过程中可以看到的背景只能是 L0 Shell Token，不能露出 `body` 渐变、透明页面底或另一套 dark background。
- 收起后 Workspace 左上/左下圆角外露区域必须显示 L0，形成有意的 8px Frame，而不是黑色缺口。
- 收起后 Sidebar Resize Handle 隐藏；8px Gap 保留为纯 L0 Frame。用户只能通过 Header 中的展开按钮恢复。

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
- Workflow editor 当前在 `Sidebar.tsx` 内通过 ref 记住旧值，并直接调用 `setSidebarCollapsed(true/false)` 实现临时收起；它把 context 原因混入了 user 偏好。
- Main Store 又存在 `sidebarCollapsed`，初始化时可能覆盖 Renderer 状态。

结论：新增 viewport 收起前必须先拆分 collapse reasons。否则用户主动收起、Workflow 进入/退出和窗口宽度变化会竞态覆盖；不能只在现有 boolean 上继续叠 effect。

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

### 4.8 深色 Surface Token 断层

文件：

```text
src/styles/globals.css
src/lib/surfaces.ts
```

当前浅色壳层：

```text
--sto-page-bg: #EDEDED
--sto-sidebar-bg: #EDEDED
--sto-main-card-bg: #FAFAFA
--sto-main-card-shadow: rgba(0,0,0,0.01)
```

当前深色壳层：

```text
--sto-page-bg: hsl(207 53% 9%)
--sto-sidebar-bg: hsl(208 40% 11%)
--sto-main-card-bg: hsl(220 22% 11%)
--sto-main-card-shadow: rgba(0,0,0,0.2)
```

这不是简单的亮暗差，而是三套不同色相/饱和度与不对称阴影共同造成的层级断裂：

- 浅色 Page/Sidebar/Gap 是一个 L0 平面。
- 深色 Page 与 Sidebar 已经被拆成两个平面。
- 深色 Workspace 又切换到另一套 `220` 色相。
- dark shadow 强度远高于 light，Workspace 被强调成独立浮岛。
- 当前 AppShell 左侧 Gap 缺失时，异色 Surface 与圆角直接相撞，出现明显黑楔。

结论：必须先修 AppShell 几何，再通过第 2.4 节的语义 Surface Token 重建层级。禁止只改 `--sto-sidebar-bg` 一个值后结束任务。

### 4.9 Collapsed 状态的直接消费者

执行时必须重新搜索，而不是只改 `MainLayout`。当前至少有：

```text
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/components/layout/ContentHeader.tsx
src/App.tsx
src/components/more-apps/AppPlazaTabStrip.tsx
src/components/sclaw-browser/SclawBrowserToolbarPortal.tsx
```

其中 `ContentHeader`、App Plaza 页签条和 Browser Toolbar Portal 当前直接读取 `sidebarCollapsed` 决定展开按钮；`App.tsx` 用它计算 Toast；`Sidebar.tsx` 还把 Workflow 临时收起写回同一字段。

结论：不能把 Store 字段机械改名后逐文件修类型。必须先建立 layout snapshot，再按角色迁移消费者：

- Sidebar 业务内容只读取 user preference 和 snapshot 的 effective 状态。
- Header/Portal 只读取 snapshot 的显示与恢复能力。
- Toast 只读取 effective width/anchor。
- CSS 只读取根节点 effective 属性和语义 Token。
- full legacy 布局仍可把 user preference 映射为 `72px` rail，但不得把省区的 viewport/context 规则误套进去。

---

## 5. 最终 DOM 与 CSS 契约

### 5.1 AppShell DOM

目标结构等价于：

```tsx
<div data-app-shell="provincial">
  <AppShellLayoutProvider>
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
  </AppShellLayoutProvider>
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
- 省区 effective collapsed 时第一列变为 `0px`，第二列自然成为左侧 `8px`。
- Sidebar Resize Handle 不得额外占据第四列。
- AppShell 根节点与第一/第二列必须显式使用 L0 Shell Token，禁止依赖透明背景透出 `body`。
- Workspace Shell 必须显式使用 L1 Workspace Token。
- `data-sidebar-collapsed`、`--sto-sidebar-effective-w` 和 Header 的 collapsed 模板必须来自同一个 effective layout snapshot。
- 可增加 `data-sidebar-collapse-reasons="user viewport context"` 供测试/调试，但任何 CSS 不得依赖具体 reason。
- user collapsed、viewport collapsed 与 context collapsed 的 DOM 几何必须完全相同；不同只存在于状态来源和解除原因的行为。

五种主要几何：

```text
expanded：          [L0 Sidebar width] [8px L0] [L1 Workspace + right/top/bottom frame]
user collapsed：    [0px]              [8px L0] [L1 Workspace + right/top/bottom frame]
viewport collapsed：[0px]              [8px L0] [L1 Workspace + right/top/bottom frame]
context collapsed： [0px]              [8px L0] [L1 Workspace + right/top/bottom frame]
full legacy：       [72px L0 rail]      [既有分隔] [L1 Workspace]
```

不得为 user collapsed、viewport collapsed 和 context collapsed 创建多套 JSX 或颜色 class。

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

### 5.7 Surface Hierarchy 契约

AppShell 与页面组件之间的颜色所有权固定如下：

| 层级 | 所有者 | 允许定义 | 禁止定义 |
| --- | --- | --- | --- |
| L0 | AppShell theme tokens | Window、Page、Sidebar、Gap 基础背景 | 页面局部覆盖 Sidebar/Gap 色 |
| L1 | WorkspaceShell | 主工作区背景、边缘、轻阴影 | 用业务页面背景替代 Workspace Surface |
| L2 | Panel/Composer shared surfaces | Preview、Composer、内容卡片 | 每个页面自行发明 dark panel 色 |
| L3 | Existing floating components | Toast、Popover、Modal | 借本任务重做全部浮层主题 |

必须满足：

```text
Sidebar background = Shell Gap background = L0
Workspace background = L1
Preview/Composer background = L2
```

“等号”表示语义 Token 归属一致。Workspace 不要求与 Sidebar 同色；它必须通过同色相体系中的有限明度差表达抬升。

Sidebar 展开与收起的层级解释：

```text
展开：L0 具有可见 Sidebar 面积，8px Gap 是其连续延伸
收起：L0 Sidebar 面积归零，但 8px Gap 和 Workspace 外框继续存在
```

因此收起不是把 Workspace 提升到 Window 根背景上，也不是让 Workspace 改成 L0。Workspace 始终属于 L1；变化的只有 L0 Sidebar 列宽。

收起状态必须额外检查：

- 左侧 8px、顶部 8px、右侧 8px、底部 8px 都来自同一个 L0 Token。
- Workspace 四角外露底色一致，不能左侧是 `body background`、右侧是 `--sto-page-bg`。
- Header 中的 Sidebar 展开按钮位于 L1，但其 hover/selected 层级必须使用 Header/Control Token，不得重新绘制一块 L0 Sidebar 背景。
- macOS 红黄绿按钮周围不得出现独立色块；原生控件区域与 Workspace/Header 的关系以设计稿为准，背景只能来自 L0 或 L1 中的一个明确所有者。
- Preview expanded 时仍保持 L0 Frame + L1 Workspace + L2 Preview 的层级，不允许 Preview 直接提升为 Window Surface。
- Workflow editor 进入/退出只能增加/解除 context collapse 原因，不能切换 L0/L1 Token，也不能覆盖 user/viewport 原因。

dark mode 视觉判断顺序：

1. 先关闭阴影或将截图转灰度，确认 L0/L1/L2 仍能读出层级。
2. 再开启极弱边缘与阴影，确认只增强曲面，不制造分裂。
3. 检查 Sidebar 的 hover/active row 仍高于 L0，且不与 L1 Workspace 混淆。
4. 检查 Preview 边框在 L1/L2 之间可辨认，但不是高对比常驻描边。
5. 检查 user collapsed、viewport collapsed、200、260、400 下 Surface 层级完全不变。

不得用业务内容截图中的偶然颜色作为 Token。所有层级值必须同时验证 light/dark，并对照 `docs/sto-design.md` 的语义规范。

---

## 6. 状态与持久化契约

### 6.1 Renderer State

在现有 Settings Store 中增加用户布局偏好，但不把拖动瞬时 rawWidth 写入持久化 Store。

建议字段：

```ts
sidebarPreferredWidth: number;
sidebarUserCollapsed: boolean;
previewSplitPercent: number;
```

现有 `sidebarCollapsed` 存储键是兼容输入。迁移后它只映射为 `sidebarUserCollapsed`，不得继续作为 effective 状态使用。

响应式和上下文临时收起由 AppShell/布局控制器派生，不持久化：

```ts
sidebarViewportCollapsed: boolean;
sidebarContextCollapsed: boolean;
```

`sidebarContextCollapsed` 当前至少覆盖 `workflowEditorActive`。现有 Sidebar 内部通过 ref 暂存并改写 `sidebarCollapsed` 的逻辑必须迁移到布局原因模型：进入上下文只置 context 原因，退出只清 context 原因，不回写用户偏好。

### 6.2 Main Store

`electron/utils/store.ts` 至少增加：

```ts
sidebarPreferredWidth: number;
```

并修复现有 `sidebarCollapsed` setter，使其通过 Host API 持久化。

Host 只持久化 user 原因，不持久化 viewport/context 原因。若为兼容旧 API 暂时保留 `setSidebarCollapsed` 名称，必须在类型和注释中明确它等价于 `setSidebarUserCollapsed`，布局组件不得将其返回值当作 effective 状态。

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
context enter/exit：只修改 context 原因，不提交 Host
viewport change：只修改 viewport 原因，不提交 Host
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

响应式收起不是第二套 Sidebar UI，也不是临时隐藏 DOM。它只是 `effectiveCollapsed` 的一个来源；Workflow editor 等上下文是另一个临时来源：

```ts
effectiveCollapsed =
  sidebarUserCollapsed ||
  sidebarViewportCollapsed ||
  sidebarContextCollapsed;
```

以下所有布局消费者只能读取同一个 effective layout snapshot，禁止各自重新推导：

```text
effectiveCollapsed
effectiveSidebarWidth
effectiveSidebarMax
previewMode
previewSplitPercent
```

处理顺序固定：

1. 根据 preview mode 计算 Workspace 最低可用宽度。
2. 计算 `effectiveSidebarMax = min(400, viewport - shell - workspaceMin)`。
3. 如果 `effectiveSidebarMax >= 200`，Sidebar 在 `200–effectiveSidebarMax` 内拖动。
4. 如果连 `200px` Sidebar 都放不下，设置 `sidebarViewportCollapsed = true`。
5. 窗口重新变宽后取消临时收起，恢复 `sidebarPreferredWidth`。
6. 不改变 `sidebarUserCollapsed`。
7. 不改变 `previewSplitPercent`。
8. 将 `effectiveCollapsed` 同步到 AppShell 根节点的 `data-sidebar-collapsed`。
9. 用户收起、响应式收起和上下文收起都使用 `0px / 8px / minmax(0,1fr)` 省区 Grid；不得出现多套 JSX 或 Surface class。
10. 窗口重新变宽只撤销 `sidebarViewportCollapsed`。若 user/context 原因仍在，视觉和几何保持收起。

三种收起只能在进入/解除语义上不同：

| 状态来源 | 是否持久化 | 原因解除后 | 展开按钮行为 | Surface/几何 |
| --- | --- | --- | --- | --- |
| `sidebarUserCollapsed` | 是 | 只有用户明确展开才解除 | 清除用户原因并恢复 preferred width；若其他原因仍在则保持收起 | 与其他收起相同 |
| `sidebarViewportCollapsed` | 否 | 空间足够时自动解除 | 空间不足时不得强行挤压；可提示需扩大窗口 | 与其他收起相同 |
| `sidebarContextCollapsed` | 否 | 离开 Workflow editor 等上下文时自动解除 | 上下文仍要求收起时不得破坏布局约束 | 与其他收起相同 |

Header 控件策略也必须来自同一 snapshot，但允许依据“能否展开”决定交互能力：

```text
showSidebarRestoreControl = effectiveCollapsed && !contextOwnsHeader
canRestoreSidebar = effectiveCollapsed && !sidebarViewportCollapsed && !sidebarContextCollapsed
```

- 纯 user collapsed：显示并启用展开按钮。
- viewport collapsed：可以保留同一占位，但按钮需 disabled，并用可访问说明提示窗口空间不足；不得点击后强行压缩 Workspace。
- context collapsed：若 Workflow editor 自己拥有 Header，则遵循其既有专用 Header，不额外塞入 Sidebar 展开按钮；退出上下文后再按剩余原因决定。
- 多原因叠加时，清除其中一个原因不能触发视觉展开，直到所有原因都为 false。

状态切换期间必须满足：

- expanded 与任一 collapsed 原因之间切换都只暴露 L0 Shell 背景。
- Workspace 始终是 L1，不能在 collapsed 时换成 Page 色或透明。
- `body`/Window 根背景不得透过 Sidebar 原位置、Workspace 圆角或动画中的 Grid Track。
- collapsed 时 Resize Handle 不渲染；中间 `8px` 仍是不可拖动的 L0 Frame。
- macOS traffic lights、Header 展开按钮和 Toast 定位在首帧就读取 effective 状态，不能等待持久化回写后跳动。

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
shell-surface-hierarchy
```

proposal 必须明确 dark mode、macOS/Windows、响应式、未提交 Overlay WIP 保护，以及 L0 Shell / L1 Workspace / L2 Panel 的跨主题层级一致性。

`shell-surface-hierarchy` spec 至少包含：

- Page、Sidebar、Shell Gap 共享 L0 语义。
- Workspace 使用 L1 语义。
- Preview/Composer 使用 L2 语义。
- light/dark 必须表达同一层级关系。
- dark mode 不得使用明显不同色相把 Sidebar 与 Workspace 拆成两个产品区域。
- dark mode 必须覆盖边缘、阴影、hover、selected、focus 和 disabled 的可读性。
- 结构性 8px Gap 先于颜色调优完成。

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
src/components/layout/app-shell-layout-context.tsx
src/components/layout/sidebar-resize-handle.tsx
tests/unit/app-shell-metrics.test.ts
tests/unit/sidebar-resize-metrics.test.ts
```

职责：

- `app-shell-metrics.ts`：纯函数计算 effective width、dynamic max、Toast anchor 所需值。
- `sidebar-resize-metrics.ts`：纯函数 clamp、snap、hysteresis、collapse threshold。
- `use-sidebar-resize.ts`：Pointer 生命周期和 RAF DOM 写入。
- `app-shell-layout-context.tsx`：唯一 runtime layout snapshot；组合 user/viewport/context 原因并向 AppShell、Sidebar、Header、Handle 提供一致结果。
- `sidebar-resize-handle.tsx`：separator 语义与键盘操作。

禁止把全部逻辑塞进 `Sidebar.tsx`，也禁止让 `MainLayout`、`ContentHeader`、Toast 分别复制 OR/宽度公式。

### 9.2 预计修改

```text
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/components/layout/ContentHeader.tsx
src/components/layout/content-header-context.tsx
src/components/layout/app-shell-layout-context.tsx
src/components/layout/sidebar-brand-header.tsx
src/components/layout/app-shell-chrome-overlay.tsx
src/components/more-apps/AppPlazaTabStrip.tsx
src/components/sclaw-browser/SclawBrowserToolbarPortal.tsx
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
.cursor/rules/02-styles.mdc
```

`docs/sto-design.md` 是主题语义事实来源，默认只读。只有确认现有规范缺少本任务可复用的基础 Surface 语义、且用户批准扩展设计规范时才允许修改；否则只更新 `.cursor/rules/02-styles.mdc` 的已验证工作模式。

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
5. 创建三个 capability spec：`resizable-sidebar-shell`、`workspace-layout-modes`、`shell-surface-hierarchy`。
6. 创建带 Requirement 名称引用的 tasks。
7. 在 spec 中写入第 3.4 节的正交状态矩阵，明确 expanded、user collapsed、viewport collapsed、context collapsed 共享 AppShell DOM、8px Frame 和 L0/L1 Surface 契约。
8. 明确根节点 collapsed 属性来自 `effectiveCollapsed`；三种收起原因只有进入、解除、持久化和 Header 能力不同。
9. 覆盖 light/dark、macOS/Windows、960/1280/1920。

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
- user/viewport/context 三类 collapse reason 的 OR 组合。
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
5. expanded 使用 `sidebarWidth / 8px / minmax(0,1fr)`；user、viewport、context collapsed 都使用 `0px / 8px / minmax(0,1fr)`。
6. AppShell 根容器拥有 L0；Sidebar 与 Gap 继承 L0；Workspace 明确使用 L1。此时只建立所有权和 Token 映射，不调最终 light/dark 色值。
7. collapsed 时 Workspace 仍是 L1，左上/左下圆角外露区域只能看到 L0；不得看到 `body` 或透明根背景。
8. 根节点提供 `data-sidebar-collapsed` 契约。若任务 5 尚未接入运行态，本任务测试可用固定状态验证，但不得创建第二套 collapsed DOM。
9. 保持 Settings 特殊分支行为不变。
10. 不接 Sidebar 拖拽。

验收：先用固定 `260/0` 验证展开和收起两种 8px；light/dark 下 expanded/collapsed 都不得露出 Window 根背景。任务 10 只校准 Token 数值，不得回头发明此处的结构。

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
- Handle 仅在 `!effectiveCollapsed && effectiveSidebarMax >= 200` 时存在。
- 越过收起阈值后只提交 user collapse 原因，并立即进入与用户按钮收起相同的 effective collapsed 几何；不得清除或改写 viewport/context 原因，释放前后均不得露出透明背景。
- collapsed 后保留 8px L0 Frame，但该 Frame 不再承担拖拽命中；通过 Header 展开按钮恢复。

本任务不得接 Host 持久化。

### 任务 5：Sidebar Collapse Reasons、持久化与响应式

允许修改：

```text
src/stores/settings.ts
electron/utils/store.ts
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/components/layout/app-shell-layout-context.tsx
src/App.tsx
tests/unit/stores.test.ts
tests/unit/app-shell-metrics.test.ts
tests/unit/app-shell-layout-context.test.tsx（可新增）
```

实现：

- sidebarPreferredWidth。
- sidebarUserCollapsed Host 持久化；如保留旧 `sidebarCollapsed` 存储键，只作为 user 原因兼容映射。
- Zustand migrate。
- viewport constrained collapse。
- context constrained collapse；把 Workflow editor 当前通过 ref 改写 `sidebarCollapsed` 的逻辑迁移为非持久化 context 原因。
- Toast 使用 effective width。
- 窗口恢复时恢复用户宽度。
- 由 `AppShellLayoutProvider` 生成唯一的 effective layout snapshot，并由 AppShell、Header、Toast 和 Resize Handle 共同读取；不得新增 `useMemo`/`useCallback` 规避普通渲染。
- AppShell 根节点 `data-sidebar-collapsed` 必须等于 `sidebarUserCollapsed || sidebarViewportCollapsed || sidebarContextCollapsed`，不能只绑定持久化字段。
- user、viewport、context collapsed 共用完全相同的 AppShell DOM、Grid 和 Surface；不得复制 Sidebar 或 Workspace 分支。
- `Sidebar.tsx` 不得再用 user 字段独立推导 `isProvincialFullyHidden`；省区显隐、`aria-hidden`、pointer-events 和昂贵列表订阅都读取 snapshot 的 effective 状态。full legacy 仍把 effective collapsed 映射为既有 `72px` rail。
- 窗口恢复时只清除 viewport 原因；Workflow editor 退出只清除 context 原因；二者都不得覆盖用户偏好。
- 多原因叠加必须逐原因解除，只有 OR 结果为 false 才展开。

不得修改 Electron API 边界模式；继续使用现有 host-api 路由。

### 任务 6：Header 模式与顶部中心线

允许修改：

```text
src/components/layout/ContentHeader.tsx
src/components/layout/content-header-context.tsx
src/components/layout/app-shell-layout-context.tsx（只消费 snapshot/扩展控件能力，不改状态所有权）
src/components/layout/sidebar-brand-header.tsx
src/components/layout/app-shell-chrome-overlay.tsx
src/components/more-apps/AppPlazaTabStrip.tsx
src/components/sclaw-browser/SclawBrowserToolbarPortal.tsx
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
8. Header 左侧避让、Sidebar 展开按钮和窗口控件必须读取 effective snapshot，不得分别从 Store、viewport 和 Workflow 状态重新推导。
9. expanded/collapsed 切换时 Header 背景连续属于对应 Surface：Sidebar 区域为 L0，Workspace Header 为 L1，不出现独立深色色块或透明缺口。
10. 纯 user collapsed 显示可用的展开按钮；viewport 原因存在时不得强行展开；Workflow editor 拥有专用 Header 时保持其既有控件语义。三者不能通过复制 Header 模板实现。

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

### 任务 10：全局 Surface Token 校准

本任务不是新增“深色模式补丁”。L0/L1/L2 的结构所有权、expanded/collapsed 共用关系和 8px Frame 已在任务 3 固定；本任务只校准 light/dark Token 数值与边缘表现。

前置条件：

- 任务 3 的 AppShell Grid 与 L0/L1 所有权已完成。
- 任务 5 的 `effectiveCollapsed` 已接入 AppShell 根节点。
- 如果 8px Shell Gap、collapsed Frame 或 Surface 所有权仍不稳定，本任务禁止开始并回到对应任务修正。

允许修改：

```text
src/styles/globals.css
src/lib/surfaces.ts（只允许 Surface class 使用语义 Token，不重新修改布局）
.cursor/rules/02-styles.mdc
tests/unit/app-shell-surface-tokens.test.ts（可新增）
```

默认不允许修改：

```text
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/pages/**
docs/sto-design.md
```

实现顺序：

1. 校准 light/dark 主题根部的 L0/L1/L2 语义 Token；不得更改其结构归属。
2. 让 `--sto-page-bg` 和 `--sto-sidebar-bg` 映射到同一个 L0 Shell Token。
3. 让 `--sto-main-card-bg` 映射到 L1 Workspace Token。
4. 让 Preview/Composer 复用现有或新增的 L2 Panel Token；禁止逐页面改背景色。
5. 调低 dark Workspace 纯黑阴影的分裂感。
6. 如需边缘高光，只能定义一个共享 Surface Edge Token。
7. 保持现有 Brand、Success、Warning、Danger、Info 语义不变。
8. 保持 Sidebar hover、active、subitem active 的交互层级可辨认。
9. 在灰度截图中验证 L0/L1/L2 仍可区分。
10. 在正常彩色截图中验证 Sidebar/Gap 连续、Workspace 抬升但不割裂。
11. 分别验证 expanded、user collapsed、viewport collapsed、context collapsed；各 collapsed 原因只允许可见 Sidebar 面积变化，不允许 Workspace Token、阴影或 Frame Token 跟随状态换色。
12. 分别验证 Preview closed/split/expanded；Preview 只能改变 L1 内部 L2 Panel 排布，不能改变 AppShell 的 L0/L1 层级。

禁止：

- 把所有 Surface 设为相同颜色。
- 只修改 Sidebar 色而不检查 Page/Gap/Workspace。
- 在组件 class 中散落新的 HSL/Hex。
- 调整业务状态色来“配合”新背景。
- 用更重的黑色阴影代替层级 Token。
- 在本任务重新调整 8px、圆角、Sidebar width 或 Split geometry。
- 为 collapsed、viewport collapsed 或 preview expanded 新增专用背景色，以掩盖结构漏洞。

定向验收：

```text
light：L0 page/sidebar/gap 连续，L1 workspace 轻抬升
dark：L0 page/sidebar/gap 连续，L1 workspace 同色相轻抬升
dark：L2 preview/composer 比 L1 可辨认但不形成高对比浮岛
dark：主卡片圆角处无异色黑楔或重阴影边
200/260/400：Sidebar、Gap、Workspace 层级关系完全相同
user/viewport/context collapsed：0px Sidebar + 8px L0 Frame + L1 Workspace 完全相同
closed/split/expanded：AppShell L0/L1 层级关系完全相同
```

### 任务 11：最终回归与文档

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
- `effectiveCollapsed = userCollapsed || viewportCollapsed || contextCollapsed` 的八种布尔组合。
- viewport 原因解除但 user collapsed 仍为 true 时，effective 状态保持 collapsed。
- user collapsed 解除但 viewport 仍受限时，effective 状态保持 collapsed。
- context 原因解除但 user/viewport 任一仍为 true 时，effective 状态保持 collapsed。
- Workflow editor 进入/退出不覆盖 user collapsed 和 preferred width。
- effective layout snapshot 中宽度、collapsed、Toast anchor 和 Handle 显隐使用同一计算结果。

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
- AppShell 根节点 `data-sidebar-collapsed` 反映 effective 状态，而不是只反映持久化的 user 状态。
- user、viewport、context collapsed 复用同一个 AppShell DOM，不存在多套 Sidebar/Workspace 分支。
- expanded 时 Sidebar/Gap 使用 L0、Workspace 使用 L1。
- 三种 collapsed 时 Sidebar 列为 0、Gap 保持 L0、Workspace 保持 L1。
- collapsed 时 Sidebar Resize Handle 不存在，但 8px Frame 仍存在。
- Preview closed/split/expanded 不改变 AppShell L0/L1 Token 归属。

### 11.3 手工视觉矩阵

视觉验收必须把各轴组合起来，禁止按五张互不相关的清单各抽一个状态：

```text
Sidebar = 200 / 260 / 400 / user collapsed / viewport collapsed / context collapsed
Preview = closed / split 30 / split 50 / split 70 / expanded / restore
Window = 960 / 1280 / 1920
Platform = macOS / Windows
Theme = light / dark
Page = Home / Task Detail / Workflow / Browser Embed / App Plaza
Special regression = Settings
```

不要求穷举笛卡尔积，但以下代表组合不得省略：

| 编号 | 平台/主题 | Sidebar | Preview | 窗口 | 核心检查 |
| --- | --- | --- | --- | --- | --- |
| A | macOS light | 260 | closed | 1280 | 默认双栏、顶部中心线、四边 8px |
| B | macOS dark | 260 | split 50 | 1920 | 三栏零缝隙、L0/L1/L2 |
| C | macOS dark | user collapsed | split 50 | 1280 | 0/8/L1、无黑楔、Header 可恢复 |
| D | macOS dark | viewport collapsed | split 50 | 960 | 与 C 视觉相同、恢复语义不同 |
| E | macOS light | 400 | expanded | 1920 | 第三栏展开不改变 AppShell 层级 |
| F | Windows dark | 200 | closed | 1280 | Window controls、最小吸附、Surface 连续 |
| G | Windows light | user collapsed | expanded | 1280 | 收起 + 第三栏展开、四边 Frame |
| H | Windows dark | viewport collapsed | closed | 960 | 临时收起、无首帧跳色/透明穿透 |
| I | macOS dark | context collapsed | split 50 | 1280 | Workflow editor 临时收起不改用户偏好与 Surface |
| J | macOS light | user + context collapsed | closed | 1280 | 退出上下文后仍因用户原因保持收起 |

对 Home 和 Task Detail 必须完整执行 A–H。Workflow 必须执行 A、B、I、J；Browser Embed、App Plaza 至少执行 A、B、C、D；Settings 只验证本任务不改变其既有特殊分支。

### 11.4 几何验收

必须满足：

```text
主卡片 top/right/bottom gutter = 8px
Sidebar 展开时 sidebar/main gutter = 8px
Sidebar 收起时 main left gutter = 8px
用户、响应式、上下文收起均为 0px Sidebar + 8px L0 Frame + L1 Workspace
收起状态下 Workspace top/right/bottom/left 外露 Frame 都属于 L0
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
- user collapsed 状态下窗口变窄再变宽，不能意外展开。
- viewport collapsed 状态下窗口变宽，在空间足够时自动恢复 preferred width。
- context collapsed 状态下退出 Workflow editor，只有在 user/viewport 原因都不存在时才恢复 preferred width。
- 三种 collapsed 原因之间叠加、解除或切换时，Grid、Header、Toast 和 Surface 不发生视觉跳变。
- collapsed 时拖拽命中区不存在，Header 展开按钮仍可键盘访问。

### 11.6 Surface 层级验收

必须满足：

- light/dark 都遵循 `L0 Window/Shell → L1 Workspace → L2 Panel`，主题只改变 Token 数值，不改变层级结构。
- expanded、user collapsed、viewport collapsed、context collapsed 的 Workspace 始终使用同一个 L1 Token。
- Sidebar 展开时 Sidebar 与 8px Gap 连续；收起时同一 L0 变为 Workspace 左侧 Frame。
- Preview closed/split/expanded 不改变外层 L0/L1，只改变 Workspace 内部 L2 的可见范围。
- dark 下 Sidebar 与 Gap 不出现色相断层；Workspace 可辨认地抬升，但不能像另一张独立深色卡片。
- 圆角、阴影、边缘高光不能在任一 collapsed 状态产生黑楔、双边或发光接缝。
- 动画首帧、中间帧、末帧都不得透出 `body` 或未定义背景。

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
11. user、viewport、context collapsed 需要多套 JSX、Workspace class 或主题色才能实现。
12. collapsed 状态会露出 `body`/Window 根背景，且无法通过任务 3 的 AppShell Surface 所有权修复。
13. 需要新增 collapsed 专用背景色、负 margin 或伪元素遮罩才能隐藏圆角黑楔。
14. `data-sidebar-collapsed` 无法由统一的 `effectiveCollapsed` 驱动，导致 Header、Toast、Handle 各自判断状态。
15. 任务 10 发现必须改 Grid、8px、圆角或运行态 JSX 才能完成主题验收；这说明前置结构未完成，必须退回任务 3/5/6，而不是继续调色。
16. Workflow editor 仍需通过 ref 保存旧值并直接改写 user collapsed 才能临时收起；这说明 collapse reason 尚未正确分层。

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
5. AppShell 根节点、Header、Toast、Resize Handle 共享同一个 effective layout snapshot。
6. user、viewport、context collapsed 共用 `0px Sidebar + 8px L0 Frame + L1 Workspace`，仅进入、解除、持久化和 Header 能力不同。
7. Sidebar 200/260/400、吸附、阈值收起、恢复和持久化全部工作。
8. Preview closed/split/expanded 全部工作。
9. Header 与 Body 共用 split boundary。
10. 滚动条轨道与第三栏边框之间没有结构性间距。
11. 顶部中心线和正文顶部留白符合设计稿。
12. OverlayScrollbar 现有行为没有回归或被复制。
13. light/dark 使用同一 L0/L1/L2 结构；expanded、三种 collapsed 和三种 Preview mode 均无跳色、黑楔或透明穿透。
14. light/dark、macOS/Windows、窄/中/宽窗口完成代表组合验收。
15. 定向测试、typecheck、diff check 通过。
16. 用户原有未提交修改全部保留。

最终产品效果应为：左侧导航在展开时可稳定拖拽，在用户主动收起、窄窗口临时收起或 Workflow 等上下文收起时使用完全相同的视觉框架；中间会话自适应，右侧预览可分栏和工作区内展开。所有状态共享统一的 L0 Shell、8px Frame、L1 Workspace、统一顶栏、零缝隙分栏和可恢复布局偏好；主题只调整层级 Token，不改变结构，临时原因也不会覆盖用户偏好。
