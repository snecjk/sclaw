# 阶段 1：AppShell 外壳与状态基座 · Cursor 开发文档

> 前置：[工作区框架升级总纲](../可拖拽侧边栏与三栏工作区框架-Cursor-T2开发文档.md) Stage 0 已由用户验收
>
> MCP：不依赖
>
> 本阶段完成后必须停止，等待用户手动验收

## 1. 本阶段唯一目标

只建立可承载后续拖拽和三栏的 AppShell 基座：

- 省区由 flex + 条件 padding 改为固定三列 Grid。
- 展开和收起都拥有同一套 8px Frame。
- 建立唯一 `AppShellLayoutProvider`。
- 分离 user/context collapse reason；viewport reason 先保留为 false 输入。
- Workflow editor 不再直接改写用户偏好。
- Toast、Header Portal、Sidebar 读取同一 effective snapshot。
- Settings/no-sidebar 路由 effective width 为 0。
- 只建立 L0/L1 Surface 所有权，不做最终主题调色。

本阶段不做：

- Sidebar 拖拽、200/400、吸附、viewport 自动收起。
- PreviewMode、三栏零缝隙、Header 56px。
- light/dark 最终颜色调整。
- OverlayScrollbar 改造。

## 2. 开始前 Preflight

完整读取：

```text
AGENTS.md
总纲
openspec/changes/workspace-shell-architecture-upgrade/**
src/App.tsx
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/components/layout/ContentHeader.tsx
src/components/more-apps/AppPlazaTabStrip.tsx
src/components/sclaw-browser/SclawBrowserToolbarPortal.tsx
src/lib/surfaces.ts
src/styles/globals.css
src/stores/settings.ts
electron/utils/store.ts
electron/api/routes/settings.ts
```

执行：

```bash
git status --short
git diff --stat
git diff -- src/App.tsx src/components/layout/MainLayout.tsx src/components/layout/Sidebar.tsx src/lib/surfaces.ts src/styles/globals.css
```

第一个 patch 前输出：

```text
阶段：1
Stage 0 OpenSpec 是否已验收：
当前未提交修改：
省区/完整布局判断入口：
Settings 特殊分支：
当前 sidebarCollapsed 写入链：
当前 Workflow 临时收起实现：
当前 Toast 宽度公式：
本阶段白名单文件：
```

如果 Stage 0 没有完成，不得修改源码。

## 3. 固定设计契约

### 3.1 Provider 位置

Provider 必须包住 Routes 和 Toaster，但不创建布局 wrapper：

```tsx
<AppShellLayoutProvider>
  <Routes />
  <ToasterConsumer />
</AppShellLayoutProvider>
```

禁止放在 `MainLayout` 内部后再要求 `App.tsx` Toast 消费。

Provider 本阶段至少输出：

```ts
interface AppShellLayoutSnapshot {
  hasSidebar: boolean;
  layoutVariant: 'provincial' | 'full';
  sidebarPreferredWidth: number; // 本阶段固定兼容值 260
  effectiveSidebarWidth: number;
  effectiveSidebarMax: number;   // 本阶段等于 260；阶段 2 接入动态值
  effectiveCollapsed: boolean;
  collapseReasons: {
    user: boolean;
    viewport: false;
    context: boolean;
  };
  canUserRestoreSidebar: boolean;
}
```

Context 只提供读取 Hook 和最小动作：

```text
useAppShellLayout()
setUserCollapsed(boolean)
```

不得复制 Zustand 数据到第二个长期 state。user reason 的权威仍是现有 `sidebarCollapsed`。

### 3.2 Route 语义

```text
login/setup/sprite/float-icon/settings：hasSidebar=false, effectiveWidth=0
省区 expanded：effectiveWidth=260
省区 collapsed：effectiveWidth=0
full expanded：effectiveWidth=260
full collapsed：effectiveWidth=72
```

Settings 保持现有特殊 DOM，不强行套入省区 Workspace Grid。

### 3.3 Collapse reasons

```ts
user = settings.sidebarCollapsed;
context = workflowEditorActive;
viewport = false; // 阶段 2 才实现
effective = user || context || viewport;
```

Workflow 进入/退出只改变 context 派生原因：

- 用户原本展开 → Workflow 中收起 → 退出恢复展开。
- 用户原本收起 → Workflow 中仍收起 → 退出仍收起。
- 删除 `Sidebar.tsx` 中保存旧值并回写 `sidebarCollapsed` 的 ref/effect。

### 3.4 AppShell DOM

省区非 Settings：

```tsx
<div data-app-shell="provincial" data-sidebar-collapsed="...">
  <AppShellChromeOverlay />
  <div className="app-shell-grid">
    <Sidebar />
    <div className="sidebar-gap" />
    <div className="workspace-wrap">
      <main className="workspace-shell">...</main>
    </div>
  </div>
</div>
```

目标：

```css
grid-template-columns:
  var(--sto-sidebar-effective-w)
  var(--sto-shell-card-gap)
  minmax(0, 1fr);
```

- AppShell Grid 占满可用高度。
- Sidebar 第一列。
- 第二列固定 8px L0 Gap；本阶段没有 Resize Handle。
- Workspace Wrapper 第三列，固定 top/right/bottom 8px。
- effective collapsed 只改变第一列为 0。
- 禁止 collapsed 时给 body 加 `p-2`。
- Workspace 四角外露底色都来自 L0。

### 3.5 Surface 所有权

本阶段只建立别名，不做最终 dark 数值：

```text
App root + Sidebar + Gap = --sto-shell-bg / L0
Workspace = --sto-workspace-bg / L1
```

允许保留兼容变量：

```css
--sto-page-bg: var(--sto-shell-bg);
--sto-sidebar-bg: var(--sto-shell-bg);
--sto-main-card-bg: var(--sto-workspace-bg);
```

禁止引入 collapsed 专用颜色。

### 3.6 Toast

Toast 读取 snapshot：

```text
no sidebar/settings：0
省区 expanded：260 + 8 gap
省区 collapsed：0 + 8 frame
full expanded：260
full collapsed：72
```

不得在 `App.tsx` 保留 `collapsed ? 72 : 260`。

## 4. 文件白名单

允许新增：

```text
src/lib/app-shell-metrics.ts
src/components/layout/app-shell-layout-context.tsx
tests/unit/app-shell-metrics.test.ts
tests/unit/app-shell-layout-context.test.tsx
tests/unit/app-shell-layout.test.tsx
```

允许修改：

```text
src/App.tsx
src/components/layout/MainLayout.tsx
src/components/layout/Sidebar.tsx
src/components/layout/ContentHeader.tsx
src/components/more-apps/AppPlazaTabStrip.tsx
src/components/sclaw-browser/SclawBrowserToolbarPortal.tsx
src/lib/surfaces.ts
src/styles/globals.css
src/stores/settings.ts
对应 OpenSpec tasks.md
```

`electron/utils/store.ts` 已有 `sidebarCollapsed`，默认不需要改 schema。本阶段只允许通过现有 host-api route 修复 Renderer setter 的持久化调用。

默认禁止：

```text
src/pages/**
Preview/Split/OverlayScrollbar 文件
electron/main/index.ts
package/lock/build/CI
```

## 5. 实施任务

一次只执行一个小任务。

### 1A：纯函数和 Provider

- 编写 route/sidebar/effective width 纯函数。
- 创建 Provider，位置在 Routes/Toaster 共同父级。
- viewport 原因固定 false，不提前实现响应式。
- 测试省区/full/no-sidebar/user/context 组合。
- 完成后停止。

### 1B：AppShell Grid

- 将省区非 Settings body 改为 Grid。
- 删除 `stoMainCardWrapClass(collapsed)` 和 `stoAppShellBodyProvincialClass(collapsed)` 的条件几何责任。
- 使用 root CSS variable 写第一列宽度。
- 验证 fixed 260/0 两种状态。
- 完成后停止。

### 1C：迁移消费者

- Sidebar 显隐读取 effective 状态。
- Workflow 删除 ref 恢复补丁。
- ContentHeader/App Plaza/Browser Toolbar 读取 snapshot。
- Toast 读取 effective width，Settings 为 0。
- `setSidebarCollapsed` 使用现有 host-api route 持久化 user reason。
- 完成后停止。

### 1D：测试与人工交付

- 补 DOM/Context/Store 测试。
- 跑精确命令。
- 提供用户手动验收清单，不进入阶段 2。

## 6. 自动测试

至少覆盖：

```text
provincial expanded => 260
provincial user collapsed => 0
provincial context collapsed => 0
user + context，解除 context 后仍 collapsed
full collapsed => 72
settings => hasSidebar false / width 0
AppShell 三列且第二列 8px
collapsed 不依赖 body p-2
Toast 无 72/260 分支
```

执行：

```bash
pnpm exec vitest run tests/unit/app-shell-metrics.test.ts tests/unit/app-shell-layout-context.test.tsx tests/unit/app-shell-layout.test.tsx tests/unit/stores.test.ts
pnpm exec eslint <本阶段实际修改的源码文件>
pnpm run typecheck
git diff --check
```

禁止为了通过测试修改阶段 2/3 文件。

## 7. 用户手动验收

启动应用：

```bash
pnpm dev
```

用户按以下顺序检查并截图。

### 7.1 默认展开

窗口建议 `1280px` 宽，进入 Home：

- Sidebar 仍是 260px，功能和列表正常。
- Sidebar 与 Workspace 之间有连续 8px 壳层底色。
- Workspace 顶、右、底均为 8px。
- 右侧不再贴窗口边缘。
- 四角外露底色一致。
- 页面无横向滚动条。

### 7.2 用户收起/展开

连续执行三次：收起 → 展开。

- 收起后 Sidebar 完全为 0。
- Workspace 左侧保留 8px，且 top/right/bottom 不跳动。
- Workspace 尺寸只增加 Sidebar 宽度，不改变圆角/阴影/背景。
- Header 展开按钮可点击和键盘聚焦。
- 展开后回到 260px。

### 7.3 Workflow context

场景 A：Sidebar 展开时进入 Workflow editor，再退出。

- editor 中临时收起。
- 退出后恢复展开。

场景 B：先由用户主动收起，再进入/退出 Workflow editor。

- 全程保持收起。
- 退出不能擅自展开。

### 7.4 Settings 和 Toast

- 进入 Settings，确认仍使用原特殊布局。
- 在 Settings 触发 Toast，Toast 应按无 Sidebar 的主区域居中。
- 回到 Home expanded 触发 Toast，按 Workspace 中心居中。
- 收起 Sidebar 再触发 Toast，中心重新计算，无明显跳到错误位置。

### 7.5 Light/Dark 结构检查

本阶段不评价最终配色，只检查：

- 两个主题下四边 Frame 都存在。
- 收起后没有透明洞、黑楔、异色三角。
- 切换主题不改变几何。

### 7.6 full legacy 回归

如果当前环境可以切换 full layout：

- expanded 仍正常。
- collapsed 保留 72px rail。
- 不应套用省区 0px 表现。

## 8. 阶段通过标准

用户只有在以下全部为“是”时确认进入阶段 2：

```text
[ ] 展开态四边 8px 正确
[ ] 收起态四边 8px 正确
[ ] 收起/展开没有条件 padding 跳变
[ ] Workflow 不覆盖用户偏好
[ ] Settings 无 Sidebar，Toast 居中正确
[ ] full legacy 无回归（若可测试）
[ ] 自动测试/typecheck/diff check 通过
```

## 9. Stop Rules

立即停止：

- Provider 无法同时覆盖 Routes 和 Toaster。
- 必须新增第二个持久化 user collapsed 键。
- 需要为收起态新增专用背景或伪元素。
- 需要修改 Preview/Split 才能完成本阶段。
- Grid 必须依赖负 margin 才能出现 8px。
- Workflow 仍需要 ref 保存并回写用户偏好。
- 发现 Settings 特殊分支必须被重写。
