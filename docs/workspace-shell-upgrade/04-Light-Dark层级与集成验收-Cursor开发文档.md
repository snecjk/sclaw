# 阶段 4：Light/Dark Surface 层级与集成验收 · Cursor 开发文档

> 前置：阶段 1、2、3 均已由用户手动验收
>
> MCP：条件使用；有 dark Frame/Surface Variables 时必须读取，没有则不阻塞
>
> 本阶段只允许 Token 校准、回归测试和文档收尾

## 1. 本阶段唯一目标

- 让 light/dark 使用相同 L0/L1/L2/L3 语义。
- 修复 dark 下 Sidebar 与 Workspace 像两个独立区域的问题。
- 保证 expanded、三种 collapsed、closed/split/expanded 的 Surface 所有权不变。
- 完成平台、窗口、路由、交互、性能和可访问性回归。
- 同步 OpenSpec tasks、样式规则和必要 README。

本阶段绝对不允许重新设计：

- AppShell Grid、8px Frame。
- Sidebar 状态、宽度和拖拽。
- PreviewMode 和 Split Grid。
- Header DOM 和内容间距。
- OverlayScrollbar 行为。

如果主题验收暴露结构错误，退回对应阶段修复，禁止在本阶段遮盖。

## 2. MCP 条件协议

### 2.1 MCP 有 dark Frame 或 Variables

必须记录：

```text
Node ID
L0/L1/L2 色值或 Variable 名称
border/edge
shadow
Sidebar hover/active
Panel background
disabled/focus 状态
```

### 2.2 MCP 只有 light

不阻塞。dark 依据总纲推导：

- 同色相或相邻冷中性色系。
- 以有限明度差表达层级。
- 极弱边缘和轻阴影辅助，不使用重黑浮岛。
- 不修改 Brand/Success/Warning/Danger/Info 业务语义。

交付报告必须写：

```text
dark mode：由 L0/L1/L2 全局契约推导，并非 MCP 逐像素匹配
```

禁止伪称 dark 与未提供的设计稿一致。

## 3. 开始前 Preflight

读取：

```text
AGENTS.md
总纲
阶段 1/2/3 的交付报告和用户验收结论
shell-surface-hierarchy spec/tasks
overlay-scrollbar-surfaces spec/tasks
docs/sto-design.md
.cursor/rules/02-styles.mdc
src/styles/globals.css
src/lib/surfaces.ts
```

执行只读检查：

```bash
git status --short
git diff --stat
rg -n "sto-page-bg|sto-sidebar-bg|sto-main-card-bg|dark:bg|shadow" src/styles/globals.css src/lib/surfaces.ts src/components/layout src/pages/Home src/pages/Chat
```

输出：

```text
阶段：4
阶段 1/2/3 是否均验收：
MCP dark/variables 是否可用：
当前 L0/L1/L2 映射：
发现的组件硬编码背景：
是否存在结构回归：
本阶段白名单文件：
```

任一前置阶段未验收时停止。

## 4. Surface 契约

### 4.1 Token

统一定义：

```css
--sto-shell-bg;
--sto-workspace-bg;
--sto-panel-bg;
--sto-surface-edge;
--sto-workspace-shadow;
```

兼容映射：

```css
--sto-page-bg: var(--sto-shell-bg);
--sto-sidebar-bg: var(--sto-shell-bg);
--sto-main-card-bg: var(--sto-workspace-bg);
```

### 4.2 所有权

```text
L0：Window/Page/Sidebar/8px Frame
L1：Workspace/Header base
L2：Preview/Composer/Panel/Card
L3：Toast/Popover/Modal
```

Workspace 不要求与 Sidebar 同色，但必须像从同一 Shell 中轻微抬升，而不是另一套蓝紫色产品区域。

### 4.3 dark 工程基线

以下只表示关系，不允许复制到多个组件：

```text
L0：最低明度
L1：比 L0 轻微提高
L2：比 L1 再轻微提高
Edge：低透明度浅边
Shadow：低透明度短阴影
```

禁止：

- Page、Sidebar、Gap 使用三个不同色相。
- Workspace 使用重黑 16px 阴影制造独立浮岛。
- collapsed 专用背景。
- Preview expanded 专用 Window 背景。
- 用 opacity 叠加碰巧得到某张截图颜色。
- 修改业务状态色配合背景。

### 4.4 状态不变量

以下状态只能改变可见面积，不能换 Token：

```text
Sidebar 200/260/400
user collapsed
viewport collapsed
context collapsed
Preview closed/split/expanded
```

任何状态切换中间帧都不能透出 body 未定义背景。

## 5. 文件白名单

允许修改：

```text
src/styles/globals.css
src/lib/surfaces.ts（仅共享 Surface class/Token 引用）
.cursor/rules/02-styles.mdc
tests/unit/app-shell-surface-tokens.test.ts（可新增）
对应 OpenSpec tasks.md
README.md / README.zh-CN.md / README.ja-JP.md（仅行为确实需要说明）
```

默认禁止：

```text
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/components/layout/ContentHeader.tsx
src/pages/**
任何 resize hook/metrics/context
electron/**
package/lock/build/CI
```

如果必须修改禁止文件，说明结构阶段没有完成，停止并返回对应阶段。

## 6. 实施任务

### 4A：Token 审计

- 建立当前 light/dark Surface 表。
- 查找页面/组件中的硬编码壳层背景。
- 区分业务状态色和 Surface 色。
- 只报告，不 patch，完成后停止。

### 4B：语义映射

- light/dark 根部定义 L0/L1/L2 Token。
- 旧变量映射到新 Token。
- Sidebar/Gap 统一 L0。
- Workspace 统一 L1。
- Preview/Composer 统一 L2。
- 完成后停止。

### 4C：Edge/Shadow 和交互状态

- 降低 dark Workspace 分裂感。
- 一个共享 edge Token。
- 验证 Sidebar hover/active、focus、disabled。
- 保持业务状态色。
- 完成后停止。

### 4D：集成回归

- 执行完整手工矩阵。
- 性能/可访问性检查。
- 更新 rules/OpenSpec/必要 README。
- 不修结构；结构问题回退阶段 1/2/3。

## 7. 自动测试

Token/DOM 测试至少覆盖：

```text
page/sidebar/gap → L0
workspace → L1
preview/composer → L2
collapsed 不切换 workspace token
preview mode 不切换 app-shell token
无 collapsed/expanded 专用硬编码背景
OverlayScrollbar reduced-motion/forced-colors 测试继续通过
```

执行：

```bash
pnpm exec vitest run tests/unit/app-shell-surface-tokens.test.ts tests/unit/app-shell-layout.test.tsx tests/unit/app-shell-layout-context.test.tsx tests/unit/sidebar-resize-metrics.test.ts tests/unit/use-sidebar-resize.test.tsx tests/unit/split-panel-layout.test.tsx tests/unit/use-split-panel-resize.test.tsx tests/unit/content-header-layout.test.tsx tests/unit/chat-preview-mode.test.tsx tests/unit/use-overlay-scrollbar.test.tsx tests/unit/overlay-scrollbar-metrics.test.ts tests/unit/stores.test.ts
pnpm exec eslint <本阶段实际修改的源码文件>
pnpm run typecheck
git diff --check
```

不存在的测试文件必须以 OpenSpec tasks 为依据创建后再运行，禁止把不存在导致的失败标记为通过。

## 8. 用户手动验收

### 8.1 最小代表矩阵

| 编号 | 平台/主题 | Sidebar | Preview | 窗口 |
| --- | --- | --- | --- | --- |
| A | macOS light | 260 | closed | 1280 |
| B | macOS dark | 260 | split 50 | 1920 |
| C | macOS dark | user collapsed | split 50 | 1280 |
| D | macOS dark | viewport collapsed | split 50 | 960 |
| E | macOS light | 400 | expanded | 1920 |
| F | Windows dark | 200 | closed | 1280 |
| G | Windows light | user collapsed | expanded | 1280 |
| H | Windows dark | viewport collapsed | closed | 960 |
| I | macOS dark | context collapsed | split | 1280 |

如果没有双平台设备，未测平台必须明确写“未验证”，不能推断通过。

### 8.2 L0 连续性

每个代表状态检查：

- Sidebar 与 8px Gap 无色相断层。
- collapsed 后左侧 Frame 与 top/right/bottom 同色。
- Workspace 四角没有黑楔、透明洞、双边。
- 收起/展开动画中没有闪出 body 背景。

### 8.3 L1/L2 层级

- Workspace 相对 L0 可辨认但不割裂。
- Preview/Composer 相对 Workspace 可辨认但不是高对比浮岛。
- Preview expanded 仍是 L0 Frame + L1 Workspace + L2 Preview。
- shadow/edge 只帮助识别曲面，不出现发光描边。

### 8.4 灰度检查

将截图转灰度或临时使用系统灰度辅助功能：

- L0/L1/L2 仍可区分。
- 不依赖色相差表达层级。
- 禁用阴影后基本层级仍成立。

### 8.5 交互色

light/dark 分别检查：

```text
Sidebar hover/active/subitem active
Header icon hover/active/focus
Resize Handle hover/drag/focus
disabled buttons
Toast success/warning/error/info
Chat error card
```

业务状态色含义不能改变。

### 8.6 页面回归

至少检查：

```text
Home
Task Detail
Workflow
App Plaza
Browser Embed
Models/Agents/Skills
Settings
```

- Settings 继续使用特殊布局。
- App Plaza/Browser Toolbar 的 Sidebar restore 正常。
- 非目标列表继续使用原 thin scrollbar。
- Embed 网页内部 scrollbar 不被改变。

### 8.7 性能回归

- Sidebar 快速拖动 10 次，无明显掉帧和宽度追赶。
- Preview 快速拖动 10 次，无明显掉帧。
- OverlayScrollbar 拖动不触发 Preview resize。
- React Profiler 中拖动不出现 Home/Sidebar 全树逐像素 commit。
- Console 无持续 ResizeObserver loop、setState after unmount、pointer capture error。
- 应用空闲时不应持续触发 RAF。

### 8.8 可访问性

- Sidebar/Preview separator 可键盘操作。
- focus-visible 在 light/dark 均可见。
- collapsed 隐藏内容不可 Tab 进入。
- expanded 隐藏 Conversation 使用 inert/aria-hidden。
- prefers-reduced-motion 下过渡明显缩短或关闭。
- forced-colors 下 OverlayScrollbar 恢复原生可用路径。

## 9. 阶段通过标准

```text
[ ] light/dark L0/L1/L2 语义一致
[ ] 三种 collapsed 无黑楔/跳色/透明穿透
[ ] closed/split/expanded 不改变 AppShell Token
[ ] 代表矩阵完成并标明未测平台
[ ] Sidebar/Preview 拖动性能无明显回归
[ ] OverlayScrollbar 行为保持
[ ] Settings/full legacy/Embed 无回归
[ ] 定向测试/typecheck/diff check 通过
[ ] OpenSpec tasks 按真实状态更新
[ ] 三份 README 已审查，必要时同步
```

## 10. Stop Rules

- 需要改 Grid、padding、圆角尺寸或 JSX 才能消除黑楔。
- 需要 collapsed/expanded 专用背景。
- 需要修改业务状态色。
- 需要重写 OverlayScrollbar。
- 需要修改 Sidebar/Preview 状态逻辑。
- MCP dark 与总纲结构冲突且用户未裁决。
- 自动测试失败来自前置阶段但企图在 Token 中规避。
