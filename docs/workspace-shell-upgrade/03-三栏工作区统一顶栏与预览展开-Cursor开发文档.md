# 阶段 3：三栏工作区、统一顶栏与预览展开 · Cursor 开发文档

> 前置：阶段 1、阶段 2 已由用户手动验收
>
> MCP：强依赖；必须读取用户指定的双栏、三栏、Preview expanded、字体和间距节点
>
> 本阶段完成后必须停止，等待用户手动验收

## 1. 本阶段唯一目标

把当前 boolean 三栏升级为完整 Workbench 布局：

- `PreviewMode = closed | split | expanded`。
- Header 与 Body 使用同一分栏边界。
- 删除 Chat/Preview 之间左右各 10px 的结构空缝。
- OverlayScrollbar rail、逻辑边界、Preview 左边框重合。
- Split Handle 为预览侧 8px overlay，只覆盖 Body Row。
- Preview expanded 只占 Workspace，不使用 DOM Fullscreen。
- Conversation 不卸载，保留草稿、scrollTop 和消息状态。
- 一级 Header 高度、字体、页签、操作按钮、macOS/Windows 控件统一中心线。
- 删除 Header 下方叠加的顶部空白。

本阶段不允许：

- 改 Sidebar 拖拽数学、持久化和 collapse reasons。
- 重写 OverlayScrollbar。
- 调最终 light/dark Surface 数值。
- 修改业务消息发送、Gateway 或文件预览内容逻辑。

## 2. MCP 强制协议

必须读取并登记：

```text
默认双栏 Frame/Node ID
普通三栏 Frame/Node ID
Preview expanded Frame/Node ID
Sidebar expanded/collapsed 下的 Header Frame（若有）
macOS/Windows Frame（若有）
```

每个节点提取：

```text
viewport 尺寸
一级 Header 高度
Preview 二级 Header 高度
标题/页签/元数据字号、行高、字重
Header 左右 padding
图标点击区
Conversation 内容起点
Preview 左边界
Scrollbar rail 位置
Preview 右/底 inset
Panel 圆角和边框
closed/split/expanded 控件位置
```

MCP 冲突规则：

- 旧节点若保留 10px×2 空缝，以用户最新要求的 0px visual seam 为准。
- 旧节点若表示浏览器/system fullscreen，以 Workspace expanded 为准。
- 旧节点若只有 `isSplitLayout`，仍需实现三种 PreviewMode。
- 数值差异只能修改语义 Token，禁止页面局部补偿。

MCP 不可用或缺少用户指定的关键节点时停止。

## 3. 开始前 Preflight

读取：

```text
AGENTS.md
总纲
阶段 1/2 交付报告与当前 diff
MCP Nodes
workspace-layout-modes spec/tasks
修订后的 chat-file-preview-enhancement design/spec/tasks
overlay-scrollbar-surfaces spec
src/components/layout/MainLayout.tsx
src/components/layout/ContentHeader.tsx
src/components/layout/content-header-context.tsx
src/lib/surfaces.ts
src/pages/Home/HomeMainConversation.tsx
src/pages/Chat/index.tsx
src/hooks/use-chat-preview-panel.ts
src/hooks/use-split-panel-resize.ts
src/components/layout/split-panel-resize-handle.tsx
src/components/ui/overlay-scrollbar.tsx（只读）
```

必须搜索：

```bash
rg -n "10px|split-preview-inset|row-span-2|translate-x|isSplitLayout|isFullscreen|fullscreenchange|panelActions|chatActions|actions" src openspec/changes/chat-file-preview-enhancement tests
```

输出：

```text
阶段：3
阶段 1/2 是否验收：
MCP Node ID 与标注：
旧 OpenSpec 是否已删除 DOM Fullscreen：
最终 Header slot 命名：
当前 split boundary：
当前 10px/row-span-2 命中：
当前 OverlayScrollbar host/rail：
本阶段白名单文件：
```

## 4. Workbench 状态契约

### 4.1 PreviewMode

```ts
type PreviewMode = 'closed' | 'split' | 'expanded';
```

固定转换：

```text
closed + open artifact → split
split + expand → expanded
expanded + restore → split（恢复上次 splitPercent）
split + close → closed
expanded + close → closed
session change → closed
```

`previewSplitPercent` 继续持久化 30–70，不因 expanded/closed 改写。

### 4.2 状态所有权

PreviewMode 属于现有 Chat Preview Hook/Workbench Context，不进入 AppShell Provider。

ContentHeader 最终注册协议统一为：

```ts
interface ContentHeaderSlot {
  title: ReactNode;
  previewTabs?: ReactNode;
  chatActions?: ReactNode;
  previewActions?: ReactNode;
  layoutMode?: 'conversation' | 'split' | 'preview-expanded';
  onCloseSession?: () => void;
}
```

最终只使用 `chatActions + previewActions`。禁止同时保留 `actions`、`panelActions`、`previewActions` 三套含义。迁移旧调用后删除弃用字段或提供一个有明确删除期限的单向兼容 adapter。

### 4.3 Conversation 生命周期

expanded 时：

- Conversation React 子树保持挂载。
- 不重建消息列表、Composer、search、scroll hooks。
- 布局隐藏并设置 `aria-hidden`/`inert`。
- 退出 expanded 后 scrollTop、草稿、搜索状态不丢。
- 不允许 `position:fixed`、Portal 或 Fullscreen API。

## 5. Grid 与边界契约

### 5.1 Workspace Grid

```css
grid-template-rows:
  var(--sto-content-header-h)
  minmax(0, 1fr);
```

### 5.2 Split Grid

```css
grid-template-columns:
  minmax(0, 1fr)
  0px
  var(--sto-split-preview-col, 50%);
```

必须满足坐标等式：

```text
chatPaneRight
= overlayScrollbarRailRight
= logicalSplitBoundary
= previewPanelLeftBorder
```

删除：

```text
--sto-split-preview-inset-x: 10px
Chat right 10px
Preview left 10px
Header 左右各 10px
Handle translate-x(10px)
```

Preview 的右侧、底部和内部内容 padding 不属于 seam，可以保留对应独立 Token。

### 5.3 Resize Handle

- Grid middle track 保持 0px。
- 命中宽度 8px，完全位于 Preview 一侧。
- 不覆盖 Chat OverlayScrollbar。
- 只占 Body Row。
- 不再 `row-span-2`。
- 默认透明；hover/dragging/focus-visible 显示 2px 提示线。
- expanded/closed 不渲染。
- 继续复用现有 `useSplitPanelResize` Pointer/RAF/cleanup。

## 6. Header 契约

Header 精确高度以最新 MCP 为准；当前确认基线为一级 `56px`，如 MCP 不同必须先报告并在 OpenSpec 统一修改。

### 6.1 conversation

```text
[Sidebar restore + title] [drag region] [chat actions] [window reserve]
```

### 6.2 split

```text
[title ........ chat actions] [0px boundary] [preview tabs .... preview actions]
```

Header 与 Body 使用同一个 `--sto-split-preview-col`，禁止各算一遍百分比。

### 6.3 preview-expanded

```text
[menu/preview tabs ................] [restore + preview actions + window controls]
```

Sidebar restore 控件仍读取 AppShell snapshot；Preview restore 读取 PreviewMode。两个按钮语义和图标不得混用。

### 6.4 Centerline

- 所有图标点击区使用 MCP/基线 32px。
- 标题、页签、操作文字用统一 line-height 和 `align-items:center`。
- 禁止单个控件 `translate-y`/`top:1px`。
- macOS traffic lights 先测现有 `{x:16,y:18}`；只有 MCP/截图证明偏差时才允许改 `electron/main/index.ts`。
- Windows controls 保留 no-drag 和点击区。

## 7. 顶部与内容密度

分开定义：

```text
Shell Frame：8px
Header Height：MCP/56px
Header Section Padding：独立 Token
Workbench Content Inset：MCP/24px
Preview Outer Seam：0px
Preview Internal Padding：独立 Token
```

Primary Conversation：

- Header 下正文立即进入 Workbench。
- 不再叠加 Main body top padding + split py + Chat scroll py 来制造大块空白。
- 消息阅读轨自己的首条内容节奏可以保留，但不属于壳层顶部。
- Composer 底部安全间距保留。

Browser Embed 有自己的 Toolbar，可保留独立 vertical padding；禁止被 Primary Conversation 规则误伤。

## 8. 文件白名单

允许修改：

```text
src/components/layout/ContentHeader.tsx
src/components/layout/content-header-context.tsx
src/lib/surfaces.ts
src/hooks/use-chat-preview-panel.ts
src/hooks/use-split-panel-resize.ts（仅必要的边界适配）
src/components/layout/split-panel-resize-handle.tsx
src/pages/Home/HomeMainConversation.tsx
src/pages/Chat/index.tsx
src/components/chat/chat-conversation-column.tsx
src/components/sclaw-browser/SclawBrowserEmbedChat.tsx（仅 Embed 独立 inset 保护）
src/components/more-apps/AppPlazaTabStrip.tsx（仅 Header 模式兼容）
src/components/sclaw-browser/SclawBrowserToolbarPortal.tsx（仅 Header 模式兼容）
src/components/layout/app-shell-chrome-overlay.tsx（仅窗口控件对齐）
electron/main/index.ts（只有 MCP 实测证明 traffic lights 需调整）
tests/unit/split-panel-layout.test.tsx
tests/unit/use-split-panel-resize.test.tsx
tests/unit/content-header-layout.test.tsx（可新增）
tests/unit/chat-preview-mode.test.tsx（可新增）
对应 OpenSpec tasks.md
```

只读/禁止修改：

```text
AppShell Grid/Sidebar resize metrics/persistence
OverlayScrollbar component/hook/metrics
业务消息/Gateway/API
package/lock/build/CI
```

## 9. 实施任务

### 3A：OpenSpec 与槽位清理确认

- 确认 DOM Fullscreen 任务已删除。
- 最终固定 `chatActions + previewActions + layoutMode`。
- 删除旧测试中对 10px seam、52px 次级 Header 和 `row-span-2` 的断言，改为本文的零 seam、统一 Header 与 Body Row Handle 断言。
- 不改源码，完成后停止。

### 3B：PreviewMode

- Hook 建立 closed/split/expanded。
- session reset、restore split percent。
- Conversation 保持挂载。
- 单元测试，完成后停止。

### 3C：零 seam Split Grid

- 删除 10px 双边结构空缝。
- Handle 移到 Preview 侧 Body Row。
- Overlay rail 对齐边界。
- 30/50/70 测试，完成后停止。

### 3D：Header layoutMode

- 三种 Header 模板。
- Header/Body 同 boundary。
- chat/preview actions 迁移。
- macOS/Windows/no-drag。
- 完成后停止。

### 3E：顶部密度

- Header height/字体/间距按 MCP Token。
- Primary top padding 清理。
- Embed 独立保护。
- 完成后停止。

## 10. 自动测试

必须覆盖：

```text
PreviewMode 全转换
session change → closed
expanded → restore split percent
Conversation expanded 时仍挂载
Grid middle = 0
无 10px shared inset
Handle 只 Body Row、Preview 侧 8px
Header 三模板
Header/Body 同 percent
Overlay rail 与 Preview boundary 契约
无 DOM Fullscreen 调用
```

执行：

```bash
pnpm exec vitest run tests/unit/split-panel-layout.test.tsx tests/unit/use-split-panel-resize.test.tsx tests/unit/content-header-layout.test.tsx tests/unit/chat-preview-mode.test.tsx tests/unit/use-overlay-scrollbar.test.tsx tests/unit/overlay-scrollbar-metrics.test.ts
pnpm exec eslint <本阶段实际修改的源码文件>
pnpm run typecheck
git diff --check
```

## 11. 用户手动验收

使用 MCP 原始 viewport、1280px、1920px 三组窗口。

### 11.1 closed 双栏

- Preview 关闭，Conversation 占满 Workspace。
- Header 标题、会话操作和窗口控件在同一中心线。
- Header 下方没有红框截图中的过高空白。
- 消息阅读轨仍居中，Composer 不漂移。
- Sidebar 200/260/400 下均正确。

### 11.2 split 三栏

- 打开产物后进入 split，不进入系统全屏。
- Header 页签与 Preview 位于同一右列。
- chat actions 停在 Conversation 列右端。
- Preview actions 位于 Preview 列。
- Chat/Preview 之间没有永久 20px 空缝。
- 将鼠标放在 Preview 左边界，出现 resize cursor/提示线。

### 11.3 Scrollbar 边界

制造足够长的对话并滚动：

- Overlay thumb 出现在 Conversation 最右边。
- thumb rail 右侧紧接 Preview 左边框。
- 两者之间没有额外白/透明带。
- 拖动 Preview Handle 不会抢走 Scrollbar thumb。
- 拖动 Scrollbar 不会触发 Preview resize。

### 11.4 30/50/70

- Preview 分别拖到 30%、50%、70%。
- Header 与 Body 分栏线始终重合，误差不超过 1px。
- 无横向 scrollbar。
- 关闭再打开仍恢复上次比例。

### 11.5 Preview expanded

- split 点击展开后 Preview 占满 Workspace，但保留 AppShell 四边 8px。
- Sidebar 状态不被改变。
- Header 切换为 expanded 模板。
- Split Handle 消失。
- 点击 restore 回到原 splitPercent。
- Conversation 的草稿、搜索、scrollTop、消息状态不丢。
- 系统窗口没有进入 fullscreen。

### 11.6 Session 切换

- 在 Session A 打开/展开 Preview。
- 切到 Session B，应回到 closed。
- 回到 A 按产品约定仍从 closed 开始，但 splitPercent 偏好保留。
- 产物 tab dismiss/select 行为正常。

### 11.7 Sidebar 组合

逐一检查：

```text
Sidebar 200 + split
Sidebar 260 + split
Sidebar 400 + split
user collapsed + split
viewport collapsed + split
Preview expanded + Sidebar expanded/collapsed
```

AppShell Frame 和 Surface 所有权不得变化。

### 11.8 macOS/Windows

macOS：

- traffic lights 不和标题/页签重叠。
- 收起 Sidebar 后左侧控件避让正确。

Windows：

- 最小化/最大化/关闭按钮可点击。
- drag-region 不吞按钮事件。
- split/expanded 下右侧预留不挤压 Preview actions。

### 11.9 字体与密度

对照 MCP：

- 标题、Preview 标题、页签、元数据字号/行高/字重一致。
- 图标点击区一致。
- 不存在单个元素 translate-y 补偿。
- Primary 与 Embed 的顶部节奏各自正确。

## 12. 阶段通过标准

```text
[ ] MCP 节点和标注完整记录
[ ] closed/split/expanded 全部通过
[ ] 无 DOM Fullscreen
[ ] Conversation 不卸载且状态保留
[ ] Header/Body boundary 误差 <=1px
[ ] Scrollbar rail 到 Preview border =0px
[ ] Handle 只覆盖 Body Row
[ ] 顶部过高空白消失
[ ] macOS/Windows 控件正常
[ ] Sidebar 所有宽度/收起组合无回归
[ ] 自动测试/typecheck/diff check 通过
```

## 13. Stop Rules

- MCP 关键 Node 不可用。
- 旧 OpenSpec Fullscreen/10px/panelActions 冲突未清理。
- 需要修改 Sidebar 状态或 AppShell Grid 才能完成。
- 必须修改 OverlayScrollbar 内部协议。
- expanded 必须卸载 Conversation 或使用 fixed/Fullscreen。
- Header/Body 只能通过两个独立百分比勉强对齐。
- 需要负 margin 或单控件 translate-y。
