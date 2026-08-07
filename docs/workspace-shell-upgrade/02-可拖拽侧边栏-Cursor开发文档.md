# 阶段 2：可拖拽侧边栏 · Cursor 开发文档

> 前置：阶段 1 已由用户手动验收
>
> MCP：强依赖；开始前必须读取用户指定的侧边栏交互 Frame/Node
>
> 本阶段完成后必须停止，等待用户手动验收

## 1. 本阶段唯一目标

在阶段 1 已稳定的 AppShell Grid 上加入 Codex 类似的 Sidebar Resize：

```text
最小 200px
默认 260px
最大 400px
默认值吸附
最小值吸附
从 200 继续向左 24px 后收起
重新展开恢复收起前 preferred width
窗口不足时临时 viewport collapsed
```

本阶段不允许重新设计：

- AppShell DOM 和 8px Frame。
- Preview/Split/Header。
- light/dark Surface 数值。
- OverlayScrollbar。

## 2. MCP 强制协议

开始前从用户指定的 MCP 节点记录：

```text
设计文件/页面
Frame/Node ID
默认 260 状态
最小 200 状态
最大 400 状态
收起状态
Resize 命中区宽度
hover/dragging/focus 提示线
Sidebar 内容在不同宽度下的截断/换行规则
收起/展开按钮位置
```

如果 MCP 与以下已确认数值冲突，先报告，不修改代码：

```text
min = 200
default = 260
max = 400
collapse extra drag = 24
AppShell Gap = 8
```

如果 MCP 没有键盘或滞回标注，使用本文工程基线，不自行发明动画。

## 3. 开始前 Preflight

读取：

```text
AGENTS.md
总纲
阶段 1 交付报告和 diff
MCP Sidebar Nodes
workspace-shell-architecture-upgrade 的 resizable-sidebar-shell spec/tasks
src/components/layout/app-shell-layout-context.tsx
src/lib/app-shell-metrics.ts
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/lib/surfaces.ts
src/styles/globals.css
src/stores/settings.ts
electron/utils/store.ts
src/hooks/use-split-panel-resize.ts（只读参考）
```

输出：

```text
阶段：2
阶段 1 是否验收：
MCP Node ID：
MCP 精确参数：
Stage 0 的 workspace 最低宽度：
当前 AppShell Grid：
当前 Provider snapshot：
当前持久化键：
本阶段白名单文件：
```

MCP 不可用、阶段 1 未验收或 workspace 最低宽度未确认时停止。

## 4. 固定交互契约

### 4.1 三种宽度

```ts
SIDEBAR_MIN = 200;
SIDEBAR_DEFAULT = 260;
SIDEBAR_MAX = 400;
SIDEBAR_COLLAPSE_THRESHOLD = 176;
```

最大值还受窗口约束：

```ts
effectiveMax = Math.min(
  400,
  viewportWidth - shellFrameWidth - workspaceRequiredWidth,
);
```

`workspaceRequiredWidth` 必须来自 Stage 0 OpenSpec 的明确数据，不允许在这里猜测。

### 4.2 preferred 与 effective

```text
sidebarPreferredWidth：用户最后提交的 200–400 宽度
effectiveSidebarWidth：当前真实渲染宽度
```

```ts
effectiveSidebarWidth = effectiveCollapsed
  ? collapsedWidthForVariant
  : Math.min(sidebarPreferredWidth, effectiveMax);
```

窗口变窄只能 clamp effective，不覆盖 preferred。窗口恢复后使用原 preferred。

### 4.3 拖动内部值

必须保留：

```text
rawWidth：指针对应宽度，允许小于 200，用于判断收起
renderedWidth：实际显示，clamp 到 200–effectiveMax
preDragWidth：本次拖动前已提交值，用于 cancel
```

禁止只保存 clamp 后的宽度，否则永远无法达到 176。

### 4.4 吸附滞回

工程基线：

```text
260 进入：±6px
260 退出：±12px
200 进入：±8px
200 退出：±14px
```

只有跨过退出范围才解除吸附，禁止单阈值抖动。

### 4.5 收起

```text
rawWidth > 176：仍保持最少 200 显示
rawWidth <= 176：提交 user collapsed
```

- 收起保留 preDrag/preferred width。
- collapsed 后 Handle 不渲染，8px Gap 继续作为 L0 Frame，但不再是拖拽命中区。
- 通过 Header 展开按钮恢复 preferred width。
- 不清除 viewport/context reason。

### 4.6 Handle

- AppShell 第二列就是 8px 命中区，不新增第四列。
- `role="separator"`、`aria-orientation="vertical"`。
- `aria-valuemin=200`、`aria-valuemax=effectiveMax`、`aria-valuenow=renderedWidth`。
- mouse/touch/pen 使用 Pointer Events。
- Pointer Capture。
- `pointercancel`、`lostpointercapture`、window blur、unmount 完整清理。
- 默认透明；hover、dragging、focus-visible 才显示提示线。
- Electron `no-drag`。

键盘工程基线：

```text
ArrowLeft：-8px
ArrowRight：+8px
Shift + Arrow：±32px
Home：200px
End：effectiveMax
```

键盘调整直接提交 preferred width，但不允许越界。Sidebar 收起继续使用明确的收起按钮，不把 Delete/Escape 解释为收起。

### 4.7 性能

pointermove：

```text
计算 raw/rendered
→ requestAnimationFrame
→ 只写 --sto-sidebar-effective-w
```

pointerup：

```text
commit Zustand once
→ host-api persist once
```

拖动中：

- 不更新 Provider state。
- 不更新 Toast React style；允许 pointerup 后同步中心。
- 禁用 Sidebar width transition。
- 不重新构造 Sidebar 列表。

## 5. 响应式契约

Provider 增加唯一 viewport observer，计算 `sidebarViewportCollapsed`。

处理顺序：

1. 根据当前 Workbench 约束选择 Stage 0 已批准的 workspace required width。
2. 计算 effectiveMax。
3. effectiveMax >= 200 时允许 Sidebar。
4. effectiveMax < 200 时设置 viewport reason。
5. 窗口恢复只清 viewport reason。
6. 不覆盖 user/context reason。
7. 不覆盖 preferred width 和 preview percent。

在阶段 3 尚未实现 PreviewMode 时，可使用 Stage 0 批准的当前页面约束；不得提前修改 Preview 代码。

## 6. 持久化

新增：

```text
sidebarPreferredWidth = 260
```

保留旧键：

```text
sidebarCollapsed = user reason
```

必须：

- 更新 Electron Store defaults/type。
- 提升 Zustand persist version。
- 旧数据迁移 preferred=260。
- 非法宽度 clamp 200–400。
- Renderer setter 通过现有 host-api route 持久化。
- viewport/context 永不写 Host。
- 不删除未知设置字段。

## 7. 文件白名单

允许新增：

```text
src/lib/sidebar-resize-metrics.ts
src/hooks/use-sidebar-resize.ts
src/components/layout/sidebar-resize-handle.tsx
tests/unit/sidebar-resize-metrics.test.ts
tests/unit/use-sidebar-resize.test.tsx
```

允许修改：

```text
src/lib/app-shell-metrics.ts
src/components/layout/app-shell-layout-context.tsx
src/components/layout/MainLayout.tsx（只挂 Handle/传 root ref，不重构 Grid）
src/components/layout/Sidebar.tsx（只接 effective 状态/宽度，不塞拖拽算法）
src/lib/surfaces.ts
src/styles/globals.css
src/stores/settings.ts
electron/utils/store.ts
src/App.tsx（只确认 Toast 读取更新后的 snapshot）
对应 OpenSpec tasks.md
对应测试
```

禁止修改：

```text
ContentHeader/Preview/Home/Chat/Split/OverlayScrollbar
electron/main/index.ts
package/lock/build/CI
```

## 8. 实施任务

### 2A：纯数学

- clamp、dynamic max、snap/hysteresis、collapse threshold。
- preferred/effective、三类原因组合。
- 单元测试。
- 完成后停止。

### 2B：持久化和 viewport reason

- Store schema/migration/Host。
- Provider 单一 observer。
- 恢复规则测试。
- 完成后停止。

### 2C：Resize Handle 和 Hook

- Pointer Capture + RAF。
- DOM CSS var 热路径。
- cancel/blur/lost capture/unmount。
- keyboard/aria。
- 完成后停止。

### 2D：接入 AppShell

- 第二列挂 Handle。
- Sidebar 使用 effective width。
- Toast pointerup 后同步。
- 确认 8px Frame 没有变化。
- 完成后停止。

## 9. 自动测试

必须覆盖：

```text
199→200，401→400
260 进入/退出吸附
200 进入/退出吸附
177 不收起，176 收起
cancel 恢复 preDrag
窗口 clamp 不覆盖 preferred
窗口恢复 preferred
user/viewport/context 八种组合
Pointer Capture 和所有清理路径
keyboard 和 aria
拖动中不提交 Store
pointerup 只提交一次
```

执行：

```bash
pnpm exec vitest run tests/unit/sidebar-resize-metrics.test.ts tests/unit/use-sidebar-resize.test.tsx tests/unit/app-shell-metrics.test.ts tests/unit/app-shell-layout-context.test.tsx tests/unit/stores.test.ts
pnpm exec eslint <本阶段实际修改的源码文件>
pnpm run typecheck
git diff --check
```

## 10. 用户手动验收

启动 `pnpm dev`，使用 MCP 对应 viewport 和 `1280px` 常规窗口各验收一次。

### 10.1 默认和自由拖动

- 启动默认宽度为 260px。
- 将鼠标移到 8px Gap，cursor 变为 col-resize。
- 拖到约 320px，Sidebar 内容和 Workspace 连续跟随。
- 拖到 400px 后不能继续变宽。
- 拖到 200px 后不能继续变窄显示。
- 全程 top/right/bottom/left Frame 不消失。

### 10.2 吸附

- 从 320 缓慢拖向 260，感受到轻吸附。
- 在 260 附近轻微往返，不应抖动。
- 明显越过退出范围后恢复自由拖动。
- 对 200 重复同样检查。

### 10.3 拖动收起与恢复

- 从 260 拖到 200，继续向左拖约 24px。
- Sidebar 收起，左侧保留 8px Frame。
- Handle 消失，Frame 不应继续显示拖拽 cursor。
- 点击 Header 展开，恢复到收起前宽度，不固定重置 260。

### 10.4 高速与异常结束

- 快速把鼠标拖出窗口再松开，不应卡住 cursor/userSelect。
- 拖动中切换窗口焦点，再回来，界面可继续正常使用。
- 连续快速拖动 10 次，无宽度跳回、无残留提示线。

### 10.5 键盘

- Tab 聚焦 Handle。
- Arrow 每次 8px；Shift+Arrow 每次 32px。
- Home 到 200；End 到 effectiveMax。
- focus-visible 提示线可见。

### 10.6 持久化

- 拖到非默认值，例如 336px。
- 完全退出并重启应用，仍为 336px（允许整数归一化）。
- 收起后重启仍收起；展开恢复 336px。

### 10.7 窄窗口

- 将窗口逐渐缩到 960px。
- Sidebar 应先降低 effectiveMax，空间确实不足时临时收起。
- 重新放宽后恢复原 preferred width。
- 用户主动收起后再缩放/放宽，不能自动展开。
- Workflow context + viewport/user 原因叠加时，只有所有原因解除才展开。

### 10.8 性能观察

- 拖动过程中消息列表、Preview（若当前打开）没有明显卡顿。
- DevTools Console 没有持续 warning/error。
- 拖动时 React 组件树不应每个像素大面积闪烁；如使用 React Profiler，不应出现 Home/Sidebar 列表逐帧 commit。

## 11. 阶段通过标准

```text
[ ] MCP 标注已记录并一致
[ ] 200/260/400 正确
[ ] 吸附无抖动
[ ] 176 阈值收起正确
[ ] 展开恢复 preferred width
[ ] 键盘和 Pointer 均可操作
[ ] 窄窗口只改变 viewport reason
[ ] 重启持久化正确
[ ] 拖动热路径无 React/Store 每帧更新
[ ] 阶段 1 的 8px Frame 无回归
[ ] 自动测试/typecheck/diff check 通过
```

## 12. Stop Rules

- MCP 数值与本文冲突。
- Stage 0 没有 workspace minimum。
- 需要修改 Preview/Header 才能计算 Sidebar。
- 拖动必须每帧 setState 才能工作。
- 需要给 Gap 新增第四列或负 margin。
- user/viewport/context 需要三套 JSX。
- Host 持久化会覆盖用户未提交的其他设置字段。
