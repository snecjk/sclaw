# 工作区框架升级总纲 · Cursor T2

> 仓库：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 风险等级：Tier 2（AppShell 与多栏工作区结构升级）
>
> 文档角色：架构总纲；阶段 1–4 后的人工验收收口以阶段 5 文档为准
>
> 日期：2026-07-31

## 0. 使用方式

本任务原采用“统一设计、单一 OpenSpec、四阶段串行实施”。阶段 1–4 已实施后，人工视觉验收确认旧 AppShell Gap、Header inset 所有权和三套 Header 模板仍有结构缺陷，因此增加阶段 5 收口。禁止把多份实施文档同时交给 Cursor，也禁止跳过前置阶段。

执行顺序：

1. 本总纲的 Stage 0：现场审计与 OpenSpec。
2. [阶段 1：AppShell 外壳与状态基座](./workspace-shell-upgrade/01-AppShell外壳与状态基座-Cursor开发文档.md)
3. [阶段 2：可拖拽侧边栏](./workspace-shell-upgrade/02-可拖拽侧边栏-Cursor开发文档.md)
4. [阶段 3：三栏工作区、统一顶栏与预览展开](./workspace-shell-upgrade/03-三栏工作区统一顶栏与预览展开-Cursor开发文档.md)
5. [阶段 4：Light/Dark Surface 层级与集成验收](./workspace-shell-upgrade/04-Light-Dark层级与集成验收-Cursor开发文档.md)
6. [阶段 5：工作区几何所有权与稳定顶栏收口](./workspace-shell-upgrade/05-工作区几何所有权与稳定顶栏收口-Cursor开发文档.md)

### 阶段 5 优先级声明

阶段 5 明确替代以下旧条款：

- 本文原 `Sidebar | 8px | Workspace` 三列真实 Gap 改为 `Sidebar | Workspace` 两列；8px Sidebar resize hit area 改为不占宽的边界 overlay。
- macOS Header safe inset 只属于 Header，不得通过 `stoSplitShellInsetsClass` 下放到整个 `main`。
- conversation / split / preview-expanded 不再使用三套 ContentHeader return，改为单一 DOM 的稳定槽位。
- Header 高度锁定 52px，Search 整体高度锁定 32px。

执行阶段 5 时，如本文后续段落仍出现被上述规则替代的旧表述，以阶段 5 文档为准。

每个阶段都必须：Preflight → 单阶段实施 → 定向测试 → 用户手动验收 → 停止。用户明确确认后才能进入下一阶段。

## 1. MCP 使用矩阵

| 阶段 | MCP 要求 | 原因 |
| --- | --- | --- |
| Stage 0 总纲/OpenSpec | 可选 | 有 MCP 时登记 Node ID 和设计溯源；无 MCP 不阻塞架构建档 |
| 阶段 1 AppShell 基座 | 不依赖 | 8px Frame、收起原因和状态所有权已经确认，不需要靠截图推导 |
| 阶段 2 可拖拽侧边栏 | 强依赖 | 需要核对 200/260/400、命中区、吸附、收起表现和交互设计稿 |
| 阶段 3 三栏/顶栏/预览 | 强依赖 | 需要核对 Header、字体、间距、分栏边界、Preview expanded 等精确标注 |
| 阶段 4 Surface/验收 | 条件使用 | 若 MCP 有 dark Frame 或 Surface Variables 必须读取；只有 light 时按本总纲语义推导 dark，不阻塞实施 |
| 阶段 5 几何收口 | 强依赖 | 使用最新顶部三状态设计、三栏/Expanded 节点和真实运行时几何，校正旧阶段人工验收失败项 |

MCP 只读。禁止 Cursor 修改设计稿、批量遍历无关页面或直接生成整页 JSX/CSS。

设计来源优先级：

1. 用户当前最新文字要求。
2. 用户指定为最新的 MCP Frame/Node。
3. 本总纲的不变量。
4. 对应阶段文档。
5. 当前代码事实（用于迁移，不用于否定新设计）。
6. 较早截图或旧 Frame。

## 2. 全局目标

最终产品必须满足：

- Workspace top/right/bottom 拥有稳定的 `8px` L0 Frame；Sidebar/Workspace 边界不再由真实 8px Grid Track 占宽。
- Sidebar 支持 `200–400px` 拖拽，默认 `260px`。
- Sidebar 支持 user、viewport、context 三种收起原因。
- 省区所有收起原因都呈现 `0px Sidebar + L1 Workspace`；macOS 左上避让只存在于 Header，Workbench Body 使用自己的正常 Surface inset。
- full legacy 保留 `72px` rail，不被省区规则误伤。
- Preview 支持 `closed / split / expanded`。
- 三栏 Header 与 Body 共用分栏边界。
- Chat OverlayScrollbar rail 与 Preview 左边框无结构性空缝。
- 一级 Header、页签、按钮和系统窗口控件共用中心线。
- Header 下正文不叠加无意义顶部空白。
- light/dark 使用相同 L0/L1/L2 层级语义。
- OverlayScrollbar、草稿、消息、scrollTop、Settings 特殊路由不回归。

## 3. 全局不可变架构

### 3.1 层级

```text
L0 Window / Shell
├─ Page
├─ Sidebar
└─ 8px top/right/bottom Frame（Sidebar/Workspace 边界 Gap=0）

L1 Workspace
└─ Main workspace surface

L2 Workbench panels
├─ Preview
├─ Composer
└─ Content cards

L3 Floating
├─ Toast
├─ Popover
└─ Modal
```

颜色可以不同，但结构所有权不随主题、Sidebar 状态或 PreviewMode 改变。

### 3.2 AppShell 几何

```css
grid-template-columns:
  var(--sto-sidebar-effective-w)
  minmax(0, 1fr);
```

```text
expanded：          [200–400 Sidebar] [L1 Workspace]
user collapsed：    [0]               [L1 Workspace]
viewport collapsed：[0]               [L1 Workspace]
context collapsed： [0]               [L1 Workspace]
full legacy：       [72 rail]          [existing Workspace]
```

Workspace Wrapper 固定承担 top/right/bottom `8px`。Sidebar 拖拽 8px 命中区作为 Workspace 起始侧的绝对 overlay，不占 Grid Track。禁止根据 collapsed 切换 body padding，也禁止让 Header safe inset 进入 Body。

### 3.3 Sidebar 状态

持久化字段只允许：

```ts
sidebarCollapsed: boolean;       // 旧存储键继续保留，只表示 user reason
sidebarPreferredWidth: number;   // 200–400，默认 260
```

非持久化原因：

```ts
sidebarViewportCollapsed: boolean;
sidebarContextCollapsed: boolean;
```

派生值：

```ts
effectiveCollapsed =
  sidebarCollapsed ||
  sidebarViewportCollapsed ||
  sidebarContextCollapsed;
```

禁止再新增第二个持久化 `sidebarUserCollapsed` 键。Host 与 Zustand 沿用 `sidebarCollapsed` 兼容旧数据，代码注释明确其语义是 user preference。

### 3.4 Context 边界

建立 `AppShellLayoutProvider`，必须位于 `Routes` 和全局 `Toaster` 的共同父级。它不产生额外布局 DOM。

它只拥有 AppShell/Sidebar 信息：

```ts
interface AppShellLayoutSnapshot {
  hasSidebar: boolean;
  layoutVariant: 'provincial' | 'full';
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
}
```

`PreviewMode` 不放进 AppShell Context。它属于 Workbench/ContentHeader Context，避免形成万能 Provider。

Settings、login、setup、sprite、float-icon 等实际无 Sidebar 的状态必须得到 `hasSidebar=false`、`effectiveSidebarWidth=0`。

### 3.5 Preview 状态

```ts
type PreviewMode = 'closed' | 'split' | 'expanded';
```

```text
closed：Conversation 占满 Workspace
split：Conversation + Preview 共用 Workbench
expanded：Preview 占满 Workspace；Conversation 隐藏但不卸载
```

禁止 DOM Fullscreen API、`position:fixed` 或卸载 Conversation 实现 expanded。

### 3.6 热路径性能

- pointermove 只经 RAF 写 CSS 变量。
- pointermove 不写 React state、Zustand 或 electron-store。
- pointerup 才提交 preferred width/percent。
- resize 期间关闭 width transition。
- AppShell 只安装一个窗口尺寸观察入口。
- Sidebar、Header、Toast 不得各自复制宽度公式或 resize listener。
- 保留现有 OverlayScrollbar；不复制、不重写滚动逻辑。

## 4. 当前代码的迁移事实

执行时必须重新核对：

- `MainLayout.tsx` 省区仍是 flex，而非 sidebar/gap/workspace Grid。
- `stoMainCardWrapClass()` 展开仅有 top/bottom 8px。
- collapsed 通过 body `p-2` 拼出四边 8px。
- Sidebar 固定 260/72，省区收起为 0。
- Workflow editor 通过 ref 直接改写 `sidebarCollapsed`。
- `App.tsx` Toast 写死 72/260，Settings 路由也可能错误偏移。
- split 左右各 10px，形成约 20px 空缝。
- Split Handle 当前 `row-span-2` 并 `translate-x(10px)`。
- Preview 只有 boolean。
- Header/ContentHeaderContext 只有 `isSplitLayout` boolean。
- dark Page/Sidebar/Workspace 色相和阴影层级不连续。

## 5. 单一 OpenSpec 策略

新建一个总 Change：

```text
openspec/changes/workspace-shell-architecture-upgrade/
```

Capabilities：

```text
app-shell-foundation
resizable-sidebar-shell
workspace-layout-modes
shell-surface-hierarchy
```

必须先完成 proposal → design → specs → tasks，才能进入阶段 1 源码。

同时修订活动 Change：

- `chat-file-preview-enhancement`：删除 10px seam、`row-span-2`、DOM Fullscreen 任务；统一为 `chatActions + previewActions` 最终命名，禁止再新增第三套 `panelActions`。
- `unify-toast-and-chat-error-feedback`：删除 72/260 假宽度，改为 effective width；Settings/no-sidebar 为 0。
- `overlay-scrollbar-surfaces`：只作为依赖；根据真实代码校准 tasks 勾选状态，不重写 Overlay。

## 6. Stage 0：只做现场审计与 OpenSpec

允许修改：

```text
openspec/changes/workspace-shell-architecture-upgrade/**
openspec/changes/chat-file-preview-enhancement/**
openspec/changes/unify-toast-and-chat-error-feedback/**
openspec/changes/overlay-scrollbar-surfaces/tasks.md（仅真实状态同步）
```

禁止修改 `src/`、`electron/`、测试和样式。

必须输出：

```text
当前 git status/diff：
真实运行入口：
活动 OpenSpec 冲突：
MCP 是否可用：
MCP Node ID（若有）：
四个 capability 是否完成：
workspace 最低宽度数据来源：
未确认设计参数：
是否可以进入阶段 1：
```

响应式最低宽度是阻塞参数。Stage 0 必须从 MCP/产品确认或在 design.md 中获得明确批准值：

```text
closedWorkspaceMin
splitChatMin
splitPreviewMin
expandedPreviewMin
```

禁止在纯函数阶段自行猜测这些数值。

### Stage 0 用户手动验收

用户不看 UI，只审文档：

- 新 Change 是否有 proposal/design/specs/tasks。
- 四个 capability 是否唯一归属。
- 旧 Fullscreen、10px、72/260 是否已明确删除或替换。
- MCP Node 与 Requirement 是否有溯源表。
- 四个最低宽度是否已有明确值；没有则不得进入阶段 1。
- Cursor 是否保持 `src/`、`electron/` 零修改。

## 7. 全局禁止项

```text
git checkout/restore/reset
整文件覆盖和全仓格式化
修改依赖、lockfile、构建配置、scripts、CI
安装或升级包
负 margin 抵消
absolute/fixed 假装分栏
collapsed 专用背景色遮黑楔
多个 Provider 重复计算 Sidebar
每帧 setState/Store
重写 OverlayScrollbar
同时执行两个阶段
```

## 8. 每阶段统一验证命令

只使用精确文件列表：

```bash
pnpm exec vitest run <该阶段列出的测试文件>
pnpm exec eslint <该阶段实际修改的源码文件>
pnpm run typecheck
git diff --check
```

禁止使用 `pnpm test -- <files>`；当前项目下该形式可能退化成全仓运行。

## 9. 每阶段交付格式

```text
完成阶段：
实现的 OpenSpec Requirements：
修改文件：
保护的既有改动：
运行的精确命令及结果：
用户手动验收步骤：
未验证平台/主题：
范围外问题：
是否满足下一阶段前置条件：
下一阶段（不自动执行）：
```

## 10. 给 Cursor 的逐阶段启动提示词

每次只把总纲和一份阶段文档交给 Cursor。不要一次性粘贴四份阶段文档。

### 10.1 Stage 0

```text
请在 /Users/tiancanyang/Documents/sto-claw/sto-claw 中执行《工作区框架升级总纲 · Cursor T2》的 Stage 0。

本次只允许现场审计与 OpenSpec proposal → design → specs → tasks，不得修改 src、electron、测试和样式。先读 AGENTS.md、总纲、现有活动 OpenSpec 和当前 git diff。保留用户现有改动，禁止 restore/reset/checkout。

如 MCP 可用，只读取用户指定节点并登记 Node ID；MCP 不可用不阻塞建档，但 closedWorkspaceMin、splitChatMin、splitPreviewMin、expandedPreviewMin 必须有明确批准值后才能宣布可进入阶段 1。

完成后按总纲交付格式报告并停止，不得自动进入阶段 1。
```

### 10.2 阶段 1–4 通用模板

```text
请在 /Users/tiancanyang/Documents/sto-claw/sto-claw 中，严格只执行《工作区框架升级总纲 · Cursor T2》和《<当前阶段文档名>》。本次是阶段 <N>，禁止提前实施下一阶段。

开始前：
1. 完整阅读 AGENTS.md、总纲、当前阶段文档、对应 OpenSpec 和当前 git status/diff。
2. 逐项确认上一阶段已验收、本阶段白名单、禁止项和停止条件。
3. 保留用户已有改动；禁止 git checkout/restore/reset、整仓格式化、改依赖/lockfile/构建/CI。
4. 如本阶段标注 MCP 强依赖，必须先只读取用户指定节点、记录 Node ID 与精确标注；缺少关键节点就停止，不凭截图猜数值。

实施时只按本阶段子任务顺序进行，每个子任务完成后先运行文档列出的定向测试。使用 pnpm exec vitest run <精确文件列表>，不要使用 pnpm test -- <files>。

完成后按总纲交付格式报告，列出用户手动验收步骤，然后停止等待用户确认。不得自动执行下一阶段。
```

替换关系：

```text
阶段 1 → 01-AppShell外壳与状态基座-Cursor开发文档.md
阶段 2 → 02-可拖拽侧边栏-Cursor开发文档.md
阶段 3 → 03-三栏工作区统一顶栏与预览展开-Cursor开发文档.md
阶段 4 → 04-Light-Dark层级与集成验收-Cursor开发文档.md
阶段 5 → 05-工作区几何所有权与稳定顶栏收口-Cursor开发文档.md
```

## 11. 总体验收定义

- 阶段 1–5 逐一人工确认；阶段 5 是阶段 1–4 实施后的几何收口验收。
- 省区 top/right/bottom 8px Frame 不依赖 collapsed padding；Sidebar/Workspace 边界无结构 Gap。
- 200/260/400、收起和恢复可靠。
- user/viewport/context 原因互不覆盖。
- closed/split/expanded 不丢 Conversation 状态。
- Header/Body/Scrollbar/Preview 共用边界。
- light/dark 层级一致。
- Settings、full legacy、App Plaza、Browser Embed 不回归。
- 定向测试、typecheck、diff check 通过。
- 用户现有修改全部保留。
- Search Surface 为 32px，打开不推动其余 Header action。
- Split/Expanded 切换时 Workspace 右侧布局按钮 x 误差不超过 1px。
- Sidebar collapsed + Preview Expanded 时 Body 不继承 macOS 80px Header safe inset。
