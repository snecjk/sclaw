# Overlay 滚动容器高度断链 · Cursor T2 局部结构修正文档

> 适用仓库：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 适用分支基线：`canyang-ui-flow6`
>
> 风险等级：Tier 2（局部结构修正）
>
> 修正对象：Cursor 已完成的 Overlay Scrollbar 接入代码
>
> 本文优先级：若本文与 `侧边栏与对话流Overlay滚动条-Cursor开发文档.md` 中的 Overlay host 示例冲突，以本文为准。

## 0. 本次只解决什么

本次只解决下面两个已复现问题：

1. Home 主对话流长内容不能滚动。
2. 消息内容越过消息 viewport，在输入框下方重新露出。

这两个现象来自同一个结构错误：Overlay 定位 host 是 flex item，但不是 flex container，导致内部真实 scroll viewport 的 `flex-1` 不生效；host 又没有裁剪溢出内容。

本次不是重新设计 Overlay Scrollbar，不重新讨论原生 scrollbar、方案 A/B/C、显隐时间或视觉宽度。

## 1. Cursor 开始前必须执行

完整读取：

1. `AGENTS.md`
2. `.cursor/rules/README.md`
3. `.cursor/rules/00-workflow-and-risk.mdc`
4. `.cursor/rules/05-engineering-guardrails.mdc`
5. `.cursor/rules/01-code-rules.mdc`
6. `.cursor/rules/02-styles.mdc`
7. 本文
8. 本文第 4 节文件白名单中的当前代码和 diff

开始前执行：

```bash
git status --short
git diff -- src/lib/surfaces.ts
git diff -- src/pages/Home/HomeMainConversation.tsx
git diff -- src/components/sclaw-browser/sclaw-browser-overlay.css
git diff -- src/components/ui/overlay-scrollbar.tsx
git diff -- docs/侧边栏与对话流Overlay滚动条-Cursor开发文档.md
```

所有未提交修改都属于用户或此前 Cursor 阶段，禁止覆盖、回退或整文件重写。

禁止使用：

```text
git checkout --
git restore
git reset
整文件替换
全仓格式化
pnpm run lint（该命令带 --fix）
```

Cursor 在第一个 patch 前必须先输出：

```text
任务：Overlay 滚动容器高度断链局部结构修正
当前分支：
当前未提交文件：
唯一真实 scroll owner：HomeMainConversation 的 scrollRef viewport
必须保持不变的 refs：scrollRef、contentRef、scrollContainerRef
允许修改文件：
明确不修改文件：
是否发现需要扩大范围：否（若为是，停止）
```

## 2. 已确认根因

### 2.1 当前错误结构

`src/pages/Home/HomeMainConversation.tsx` 当前结构等价于：

```tsx
<div className="relative min-h-0 min-w-0 flex-1">
  <div ref={scrollRef} className={stoChatScrollPaneClass}>
    <div ref={contentRef}>{messages}</div>
  </div>
  <OverlayScrollbar viewportRef={scrollRef} contentRef={contentRef} />
</div>
```

其中：

- 外层 host 作为 `ChatConversationColumn` flex column 的子元素，`flex-1` 可以控制 host 自身高度。
- 但 host 没有 `display: flex`，所以它内部 viewport 上的 `flex-1` 没有效果。
- viewport 作为普通 block 按消息内容高度增长，无法在输入框上方形成受限高度。
- viewport 的 `overflow-y-auto` 没有可供溢出的固定/受限高度，因此 `scrollTop` 不形成有效滚动。
- host 默认 `overflow: visible`，消息会越过 host，和后面的输入框 sibling 重叠。
- 输入框依靠后出现顺序和 `z-10` 只遮住中间一段，消息超过输入框底部后会重新露出。

### 2.2 为什么 Overlay thumb 也可能不出现

当 viewport 跟随内容一起增高时，Overlay 几何读取结果可能接近：

```text
scrollHeight === clientHeight
```

`calculateOverlayScrollbarMetrics()` 会正确判断为 `hasOverflow = false`。因此 thumb 不出现不是几何算法错误，而是 viewport 没有被布局约束。

### 2.3 正确同类实现证据

Embed Chat 的 host 已经包含：

```css
position: relative;
display: flex;
flex: 1 1 auto;
flex-direction: column;
min-width: 0;
min-height: 0;
```

这证明当前项目需要的不是第二套滚动逻辑，而是把同一 host 布局契约统一到 Home、Sidebar 和 Embed。

## 3. 固定目标结构

所有 Overlay 纵向滚动面统一遵守：

```text
Overlay Host
relative + flex + flex-col + flex-1 + min-h-0 + min-w-0 + overflow-hidden
├─ Viewport（唯一 scroll owner）
│  min-h-0 + flex-1 + overflow-y-auto
│  └─ Content measurement root
│     正常内容高度，不设置 overflow-y-auto
└─ OverlayScrollbar
   absolute，不占布局宽度，不拥有 scrollTop
```

固定语义：

| 层级 | 可以做 | 禁止做 |
| --- | --- | --- |
| Host | flex 高度分配、relative 定位、裁剪越界绘制 | 不设置 `overflow-y-auto`，不持有 scrollRef |
| Viewport | 持有现有 scrollRef、纵向滚动、overscroll | 不按内容无限增高，不创建替代 ref |
| Content | 持有 contentRef、提供 ResizeObserver 尺寸 | 不成为第二个滚动区 |
| OverlayScrollbar | 绝对定位、读取 viewport、拖动写 scrollTop | 不参与 flex 尺寸，不包裹 composer |

共享 host class 固定为：

```ts
export const stoOverlayScrollHostClass =
  'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden';
```

不得给 Home、Sidebar、Embed 分别发明不同的 Tailwind host 组合。

## 4. 修改范围

### 4.1 默认文件白名单

只允许修改：

```text
src/lib/surfaces.ts
src/pages/Home/HomeMainConversation.tsx
src/components/sclaw-browser/sclaw-browser-overlay.css
src/components/ui/overlay-scrollbar.tsx
docs/侧边栏与对话流Overlay滚动条-Cursor开发文档.md
```

说明：

- `src/components/layout/Sidebar.tsx` 当前已经通过 `sidebarScrollOverlayHostClass` 接入，不需要改 JSX。
- Sidebar 的 host/viewport 统一在 `src/lib/surfaces.ts` 修正。
- `overlay-scrollbar.tsx` 只改注释示例，不改组件行为。
- 原开发文档只改错误结构示例和对应固定说明，不重写其他章节。

### 4.2 明确禁止修改

```text
src/components/layout/MainLayout.tsx
src/pages/Home/index.tsx
src/pages/Home/HomeAgentHubSurface.tsx
src/pages/Home/home-hub-surface-styles.ts
src/hooks/use-overlay-scrollbar.ts
src/lib/overlay-scrollbar-metrics.ts
src/hooks/use-stick-to-bottom-instant.ts
src/hooks/use-chat-scroll-follow.ts
src/pages/Chat/index.tsx
src/components/layout/sidebar-project-session-row.tsx
src/components/layout/sidebar-recent-session-row.tsx
package.json
pnpm-lock.yaml
vite/vitest/electron-builder/CI 配置
```

禁止修改原因：

- Home full-bleed 外层已经实现，不是本次根因。
- scroll/activity/metrics Hook 的逻辑不是本次根因。
- 两个 sidebar session row 存在用户字重修改，必须保护。
- 本次不涉及依赖、工程配置、API、IPC、Gateway 或持久化。

如果实现需要修改禁止列表中的任意文件，立即停止并说明理由，不得自行扩大范围。

## 5. 分步实施

一次只做一个步骤。每步完成后检查对应文件 diff，再继续。

### 步骤 1：建立共享 Overlay host class

文件：`src/lib/surfaces.ts`

在共享 Chat scrollbar surface 附近新增：

```ts
/** Overlay scrollbar 定位壳：分配剩余高度、约束真实 viewport，并裁剪越界内容。 */
export const stoOverlayScrollHostClass =
  'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden';
```

硬性要求：

- 只定义一份。
- 名称必须是 `stoOverlayScrollHostClass`。
- 必须同时包含 `relative flex flex-col min-h-0 min-w-0 flex-1 overflow-hidden`。
- 不加入颜色、padding、margin、z-index、scrollbar 宽度或动画。
- 不加入 `h-full`、`overflow-y-auto` 或 `scrollbar-gutter`。

完成后执行：

```bash
git diff -- src/lib/surfaces.ts
```

### 步骤 2：修正 Home 对话 Overlay host

文件：`src/pages/Home/HomeMainConversation.tsx`

操作：

1. 从 `@/lib/surfaces` 导入 `stoOverlayScrollHostClass`。
2. 将当前：

```tsx
<div className="relative min-h-0 min-w-0 flex-1">
```

替换为：

```tsx
<div className={stoOverlayScrollHostClass}>
```

3. 保持内部 DOM 顺序不变：

```text
Host
├─ viewport（ref={scrollRef}）
│  └─ content（ref={contentRef}）
└─ OverlayScrollbar
```

4. 保持 composer 是 Host 后面的 sibling，不得把 composer 移进 Host。

本步骤禁止：

- 不修改 `scrollRef` 或 `contentRef` 的来源和绑定。
- 不修改 `stoChatScrollPaneClass` 的 `overflow-y-auto`。
- 不给 viewport 增加固定像素高度、`max-height` 或 `calc(100vh - ...)`。
- 不给 composer 增加更高 z-index 来遮挡问题。
- 不移动或复制 `OverlayScrollbar`。
- 不调整消息、输入框、Jump to latest 或 preview JSX。

完成后检查：

```bash
git diff -- src/pages/Home/HomeMainConversation.tsx
```

该文件 diff 应只新增一个 import，并替换一个 host className。若出现其他 hunk，停止并清理越界修改。

### 步骤 3：统一 Sidebar host/viewport 高度契约

文件：`src/lib/surfaces.ts`

将现有：

```ts
export const sidebarScrollOverlayHostClass =
  'relative min-h-0 min-w-0 flex-1';
```

改为直接复用：

```ts
export const sidebarScrollOverlayHostClass = stoOverlayScrollHostClass;
```

将 `sidebarScrollContainerClass` 中的 viewport 高度策略从：

```text
h-full min-h-0
```

恢复为：

```text
min-h-0 flex-1
```

原因：host 现在是 flex column，viewport 应由 `flex-1` 获取剩余高度，而不是依赖 `height: 100%`。

保持不变：

- `scrollContainerRef` 仍绑定 viewport。
- viewport 仍是 `flex flex-col`。
- `overflow-x-hidden overflow-y-auto overscroll-y-contain` 保留。
- Sidebar JSX、sticky refs、contentMeasureRef 和 OverlayScrollbar 顺序不变。

完成后执行：

```bash
git diff -- src/lib/surfaces.ts
git diff -- src/components/layout/Sidebar.tsx
```

第二条命令只用于确认此前 Cursor diff，没有授权新增 Sidebar.tsx hunk。

### 步骤 4：统一 Embed Chat host

文件：`src/components/sclaw-browser/sclaw-browser-overlay.css`

当前 `.sclaw-browser-embed-chat__scroll-host` 已有正确 flex column 结构，只补：

```css
overflow: hidden;
```

当前 `.sclaw-browser-embed-chat__scroll` 中的：

```css
height: 100%;
```

应删除。viewport 已通过共享 `stoChatScrollPaneClass` 获得 `flex-1`，不再同时维护 `height:100%` 与 flex 两套高度策略。

最终等价结构：

```css
.sclaw-browser-embed-chat__scroll-host {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sclaw-browser-embed-chat__scroll {
  min-height: 0;
}
```

禁止修改 Embed 的宽度、header、composer、error、session 或 webview 样式。

### 步骤 5：修正文档和组件示例

文件：

```text
src/components/ui/overlay-scrollbar.tsx
docs/侧边栏与对话流Overlay滚动条-Cursor开发文档.md
```

只修正示例中的 host：

```tsx
<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
```

同时补充一句硬约束：

```text
Host 必须同时是受限高度的 flex item 和 flex column；缺少 flex/flex-col 会让 viewport 的 flex-1 失效，缺少 overflow-hidden 会导致消息越过 composer 边界。
```

禁止在本步骤重新改写 OverlayScrollbar API、计时、可访问性、颜色、几何或任务拆分。

## 6. 不接受的“修复方式”

出现下面任一种方案都应拒绝并停止：

- 给 Home viewport 写固定高度或 `calc(100vh - ...)`。
- 给 composer 增加 z-index 以遮住泄漏消息。
- 把 `overflow-y-auto` 移到 Host，制造新的 scroll owner。
- 同时让 Host 和 viewport 都可纵向滚动。
- 把 `scrollRef` 移到 Host。
- 把 `contentRef` 移到 viewport 或 composer。
- 修改 `useOverlayScrollbar` 让它“强制认为有 overflow”。
- 修改几何算法绕过 `scrollHeight === clientHeight`。
- 恢复原生 `scrollbar-gutter: stable`。
- 使用负 margin、绝对高度、平台判断或多层 `calc()`。
- 为三个 consumer 分别复制不同的 host class。
- 顺手格式化 `HomeMainConversation.tsx` 大段 JSX。

## 7. 验证顺序

### 7.1 静态检查

执行：

```bash
rg -n "stoOverlayScrollHostClass|sidebarScrollOverlayHostClass|sclaw-browser-embed-chat__scroll-host" src
pnpm test -- tests/unit/overlay-scrollbar-metrics.test.ts tests/unit/use-overlay-scrollbar.test.tsx
pnpm run typecheck
git diff --check
```

说明：

- 不运行 `pnpm run lint`，因为当前 script 会自动修改全仓库。
- 不修改测试配置。
- jsdom 无法证明真实 flex 高度和 scrollbar 是否工作，单元测试通过不能替代实机验证。

### 7.2 Home 非 split 实机检查

使用长对话，必须逐项确认：

1. Overlay Host 的 computed style：
   - `display: flex`
   - `flex-direction: column`
   - `min-height: 0px`
   - `overflow-x/y` 不允许内容可见穿透；应体现 hidden 裁剪
2. viewport computed style：
   - `overflow-y: auto`
   - 可见高度小于长内容高度
3. DOM 数值：
   - `viewport.scrollHeight > viewport.clientHeight`
   - 滚轮后 `viewport.scrollTop` 改变
4. Overlay：
   - `data-overflow="true"`
   - 滚动时 `data-active="true"`
   - 停止识别后立即进入淡出
5. Composer：
   - 消息只显示在 composer 上方
   - composer 下方不再露出消息
   - Jump to latest 位置不变

### 7.3 Home split 检查

- 打开 preview。
- 分别拖到 30% 和 70%。
- 对话 viewport 仍可滚动。
- 消息不穿出左侧对话卡片。
- Overlay 贴对话列右缘，不贴整个窗口右缘。
- resize handle 可点击，不被 Overlay rail 阻挡。
- 开关 preview 不重置当前 scrollTop。

### 7.4 Sidebar 检查

- 项目、任务、最近全部展开形成长内容。
- Sidebar 只有中部 viewport 滚动。
- sticky 接力和自动收起仍工作。
- 消息/项目行不穿到底部账户区。
- Overlay 可拖动且不阻挡行尾按钮。
- 折叠 Sidebar 后无多余 scrollbar。

### 7.5 Embed Chat 检查

- Embed Chat 长对话可滚动。
- Embed composer 上下边界正常。
- Embed Overlay 和旁边 webview scrollbar 独立。
- 关闭 Embed 后无残留 Overlay。

## 8. Stop Rules

出现任一情况立即停止：

- 需要修改第 4.2 节禁止文件。
- `scrollRef` 不再绑定原 viewport。
- Host 或 viewport 新增固定高度/calc。
- 页面出现两个纵向滚动 owner。
- 修复 Home 后 Sidebar 或 Embed 失去滚动。
- split 模式需要另一套 host class 才能工作。
- 输入框仍靠 z-index 遮挡泄漏内容。
- 同一问题连续修改 3 次仍未解决。
- typecheck 或定向测试出现无法解释的新失败。
- diff 混入两个 sidebar session row 的用户字重修改。

停止后只报告：阻塞点、当前 diff、最后可验证状态和需要人工确认的问题，不继续堆补丁。

## 9. 完成交付格式

Cursor 必须按下面格式输出：

```text
任务：Overlay 滚动容器高度断链局部结构修正
结果：完成 / 部分完成 / 已停止
修改文件：
未修改但存在用户 diff 的文件：
Home 唯一 scroll owner：
Home scrollRef/contentRef 是否保持：
Sidebar scrollContainerRef 是否保持：
共享 host class 最终值：
定向测试结果：
typecheck 结果：
git diff --check 结果：
Home 非 split 实机：
Home split 实机：
Sidebar 实机：
Embed 实机：
macOS：通过 / 失败 / 未验证
Windows：通过 / 失败 / 未验证
已知限制：
```

未实测的项目必须写“未验证”，不得写“理论上正常”或“应该没问题”。

## 10. 可直接复制给 Cursor 的提示词

```text
请执行一次 T2 范围内的局部结构修正。完整读取 AGENTS.md、项目 Cursor rules，以及 docs/Overlay滚动容器高度断链-Cursor-T2局部结构修正文档.md。

这次只修复 Overlay scroll host 高度断链：Home 长对话不能滚动，且消息从 composer 下方漏出。先输出文档第 1 节 Preflight，再严格按第 4 节白名单和第 5 节步骤实施。

核心固定结构是：Host = relative + flex + flex-col + flex-1 + min-h-0 + min-w-0 + overflow-hidden；Viewport 保持现有 scrollRef、min-h-0、flex-1、overflow-y-auto；Content 保持现有 contentRef；OverlayScrollbar 仍是 viewport sibling。

必须新增并复用 stoOverlayScrollHostClass；Home 只替换 host class；Sidebar 通过 surfaces.ts 复用共享 host 并把 viewport 从 h-full 恢复到 flex-1；Embed host 只补 overflow:hidden 并删除 viewport height:100%。修正 overlay-scrollbar.tsx 和原开发文档中的错误示例。

禁止修改 MainLayout、Home full-bleed 外层、useOverlayScrollbar、metrics、scroll follow、stick-to-bottom、Chat/index、两个 sidebar session row、依赖和工程配置。禁止固定高度、calc、负 margin、提高 composer z-index、移动 refs、制造第二个滚动 owner或全仓格式化。

每一步后检查单文件 diff。完成定向测试、typecheck、git diff --check和文档第 7 节实机验收后，按第 9 节格式交付并停止。不要继续做其他 UI 调整。
```
