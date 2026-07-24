# 三栏工具区与无痕拖拽边界 · Cursor Auto 开发文档

> 本文是本次改造给 Cursor Auto 的施工依据。Cursor 必须先读取真实代码和设计稿 MCP，再按本文限定范围实施；不得通过负 margin、绝对位移或继续保留旧分隔条来“对截图”。
>
> - 风险等级：**Tier 2（局部结构调整 / 局部重构）**
> - 日期：2026-07-22
> - 设计依据：用户提供的三张现状/设计截图，以及后续提供给 Cursor 的设计稿 MCP
> - 规则优先级：本次已确认设计与本文 > `.cursor/rules/00-workflow-and-risk.mdc` > `.cursor/rules/01-code-rules.mdc` > `.cursor/rules/02-styles.mdc` > `docs/sto-design.md` > 旧开发文档
> - 与旧文档冲突时：本文覆盖 `docs/对话流改造-任务4-三栏框架与预览区.md` 中关于顶部工具归属、4px 分隔列、灰色拖拽线和旧拖拽事件模型的描述；旧文档其他已实现内容不在本次重做。

---

## 0. 一句话目标

保留现有 `MainLayout + 统一 CSS Grid + previewSplitPercent` 架构，把三栏顶部的三个会话工具移回左侧对话区边界附近，并将现有“4px 分隔列 + 短灰线”改造成**不占布局宽度的覆盖式透明拖拽热区 + 对齐预览框左描边的 `#FFD6BA`/2px 提示线（默认隐藏）**。

本任务不是重写侧边栏，也不是重写产物预览；它是对现有三栏布局边界的一次局部结构收敛。

> **概念拆分（必须遵守）**：① Grid 逻辑边界（0px 轨道）② 透明命中区（约 12px，不占宽，与预览框左描边对齐）③ 提示线（`#FFD6BA` / 2px，`pointer-events-none`；默认隐藏，hover / dragging / focus-visible 显示）。“无痕”指不占布局宽度、不出现旧短灰线、默认不常显提示线。

---

## 1. 用户已确认的产品决策

以下结论已经确认，Cursor 不需要再次提问：

1. 三栏展开后，红框中的三个会话级 icon——**搜索、刷新、思考过程**——移动到箭头方向，即左侧对话区标题栏的右端、靠近分栏边界。
2. **预览展开/收起**属于面板控制，不与上述三个会话工具捆绑；三栏展开时继续放在右侧预览区尾部。
3. 产物菜单和产物 tab 属于右侧预览区，继续从右侧预览列起始位置排列。
4. **不能仅删除灰线并保留原 4px 命中区。**原 4px 分隔列必须从布局中取消。
5. 拖拽交互必须按照设计稿：拖拽热区覆盖预览框左描边附近，不占据左右区域的布局宽度；命中区与视觉线共用同一几何锚点。
6. 默认、hover、拖拽中均不显示现有短灰色竖线/胶囊线；提示线固定 `#FFD6BA` / 2px；**默认隐藏**；鼠标悬浮命中区、正在拖拽（含全屏 overlay）、focus-visible 时显示；拖拽结束且离开命中区后隐藏。
7. 保留现有预览宽度 30%–70% 夹取、默认 50% 和持久化行为，不修改设置字段语义。
8. 不改消息收发、产物扫描、文件预览、分享、下载、全屏、刷新等业务逻辑。
9. 三栏 Header 左区必须铺满 Grid 第一列，使搜索/刷新/思考贴在对话区右边界，不得紧跟标题。
10. 预览 inset（横向 10px / 纵向 8px）由统一 CSS variable 共享给 Header/Body padding 与 resize handle，避免漂移。

若 MCP 明确展示了新的临时拖拽反馈，Cursor 只能在 Phase A 中列出差异，不得自行恢复灰线；不得把 `#FFD6BA` 写入全局 primary。

---

## 2. 风险分级与工作流

### 2.1 为什么是 Tier 2

本次不只是 className 微调，还会涉及：

- `ContentHeaderSlot` 的局部组件契约调整；
- 三栏 Grid 列结构调整；
- 拖拽 handle 的 DOM 结构与事件模型调整；
- Chat 与 Home 两个使用方的共用组件收敛。

因此属于 `.cursor/rules/00-workflow-and-risk.mdc` 定义的 Tier 2，不能按 Tier 1 直接补 CSS。

### 2.2 已完成的方案确认

用户已经确认采用本文推荐方案，因此 Cursor 不需要重新提交 2–3 套方案等待选择。Cursor 仍必须先执行 Phase A 的代码/MCP 对照；只有出现本文 Stop Rules 中的真实冲突时才停下来询问。

### 2.3 OpenSpec 处理

仓库已有：

`openspec/changes/chat-file-preview-enhancement/`

其中 `chat-file-preview-resize` 的设计仍描述固定像素宽度、3px/窄 resizer 和旧鼠标事件，已与当前实现不一致。本次不要再创建第二套冲突的 resize capability。

Cursor 在写代码前必须：

1. 读取 `openspec/config.yaml` 和上述 change 全部 artifact。
2. 仅校正该 change 中与 resize 直接相关的 proposal/design/spec/tasks：
   - 当前宽度来源为 `previewSplitPercent`；
   - 范围为 30%–70%，默认 50%；
   - 宽度由统一 Grid 的 `--sto-split-preview-col` 控制；
   - 分隔边界不展示短灰线；提示线为 `#FFD6BA`/2px，默认隐藏，hover/dragging/focus-visible 显示；
   - 不存在占布局宽度的 4px resizer column；
   - 透明热区与提示线对齐预览框左描边（共享 inset），不是逻辑分界中心；
   - 对话区 Header zone 铺满第一列，会话工具贴右边界；
   - Chat 与 Home/任务子项共用同一实现，并传递 `isResizing`；
   - 包含亮色、暗色和 Electron `no-drag` 验收。
3. 保留同一 change 中 iframe reload 和 fullscreen 的既有需求，不借本任务重写它们。
4. tasks 必须引用对应 Requirement 名称，并标明本次新增/修正任务。

如果 Cursor 判断直接改旧 change 会破坏其他尚未交付工作的审计历史，必须先输出冲突和建议，停止修改 OpenSpec；不得悄悄新建重复 capability。

---

## 3. 现状代码画像

Cursor 动手前必须重新核对以下位置，行号以当前代码为准：

| 文件 | 当前职责 | 已知问题 |
| --- | --- | --- |
| `src/components/layout/MainLayout.tsx` | 三栏时让 `<main>` 成为 Header/Body 共用 Grid | 核心架构正确，应保留 |
| `src/lib/surfaces.ts` | 三栏轨道、Header/Body grid placement、resizer surface、比例工具 | 当前模板为 `1fr + 4px + preview`，并额外有两侧 `gap-x-2` |
| `src/components/layout/content-header-context.tsx` | 页面向全局 Header 注入 title/previewTabs/actions | 只有一个 `actions`，无法区分会话工具与面板工具 |
| `src/components/layout/ContentHeader.tsx` | 双栏/三栏标题栏排版 | 三栏时把全部 actions 放入预览列最右端 |
| `src/pages/Chat/ChatSearchBar.tsx` | 搜索、刷新、思考、预览开关入口 | 四类操作被同一个 Fragment 捆绑 |
| `src/hooks/use-split-panel-resize.ts` | Chat/Home 共用拖拽逻辑与宽度同步 | 仍使用 Mouse Events；缺少可靠的卸载中拖拽清理 |
| `src/pages/Chat/index.tsx` | Chat 三栏调用点 | 自己渲染短灰线和 resizer DOM |
| `src/pages/Home/HomeMainConversation.tsx` | 首页/任务子项会话三栏调用点 | 重复 Chat 的短灰线和 resizer DOM |

### 3.1 当前顶部错位根因

当前 `ChatContentHeaderActions` 将以下内容一次性返回：

```text
搜索 + 刷新 + 思考 + 预览开关
```
三栏时 `ContentHeader` 将整个 `actionsZone` 放在预览列，所以三个会话工具自然被推到窗口最右端。禁止使用 `translateX`、负 margin、`position:absolute` 或按 preview 百分比计算图标位移解决。

### 3.2 当前拖拽边界错位根因

当前 Grid 等价于：

```text
对话列 + 8px gap + 4px resizer column + 8px gap + 预览列
```

随后 Chat/Home 又在 4px 列中分别画出 `2px × 32px` 的短灰线。这样把四个概念混在了一起：

- 面板比例边界；
- 面板视觉间距；
- pointer 命中区；
- 可见拖拽装饰。

本次必须把概念拆开：比例边界是唯一真值；面板视觉间距由共享 inset 变量控制；命中区与提示线对齐预览框左描边但不占宽；旧短灰线取消；提示线默认隐藏。

---

## 4. 不可修改边界

本次不得修改：

- `src/components/layout/Sidebar.tsx` 及左侧导航业务；
- `src/hooks/use-chat-preview-panel.ts` 的文件扫描、激活、dismiss 业务；
- `src/pages/Chat/ChatPreviewPanel.tsx` 的预览操作逻辑；
- `src/components/file-preview/` 内的渲染逻辑；
- `src/stores/chat*`、Gateway、IPC、Host API、Main 进程；
- `src/stores/settings.ts` 中 `previewSplitPercent` 的字段、默认值、persist 结构和 30–70 语义；
- 路由、消息发送、工作流、定时任务和预览数据模型；
- `package.json`、lockfile、构建配置、测试配置、脚本、CI/CD。

不得新增依赖，不得运行安装/升级/移除依赖命令。

---

## 5. 目标架构

### 5.1 顶部操作按语义拆槽

推荐把全局 Header 槽位调整为：

```ts
export interface ContentHeaderSlot {
  title: ReactNode;
  previewTabs?: ReactNode;
  /** 页面/会话级操作：搜索、刷新、思考等 */
  actions?: ReactNode;
  /** 面板级操作：预览展开/收起等 */
  panelActions?: ReactNode;
  isSplitLayout?: boolean;
  onCloseSession?: () => void;
}
```

命名可根据真实代码微调，但必须保留“页面/会话操作”和“面板操作”两个语义，不允许重新合并成一个无法分栏的 Fragment。

`ContentHeader` 的布局规则：

```text
双栏：title | flexible spacer | actions | panelActions | Win controls reserve

三栏左列：title | flexible spacer | actions
三栏右列：previewTabs | flexible spacer | panelActions | Win controls reserve
```

具体顺序、间距、左右 padding、icon 尺寸、active/hover 颜色从 MCP 读取。已确认的位置语义不能被 MCP 取值过程推翻。

### 5.2 Chat 操作组件拆分

将当前 `ChatContentHeaderActions` 拆成两个职责清楚的节点：

1. 会话操作：
   - `ChatSearchBar`
   - 刷新
   - 思考过程开关
2. 面板操作：
   - 预览展开/收起

推荐命名：

```text
ChatConversationHeaderActions
ChatPreviewPanelActions
```

若面板控制只有一个按钮，组件名仍可用复数以匹配 Header slot。不要为了复用创建新的 store 或 Context。

Chat 与 Home 必须接入同一组组件；不能只修 Chat 截图而留下 Home/任务子项旧布局。

### 5.3 Grid：零宽逻辑边界，不保留 4px 列

统一 Grid 保留 3 个逻辑轨道，但中间轨道必须为 `0px`：

```text
minmax(0, 1fr) | 0px | var(--sto-split-preview-col, 50%)
```

关键约束：

- 中间 `0px` 仅用于给 grid item 提供稳定定位坐标；不占左右面板宽度。
- 删除当前 `gap-x-2` 对 resizer column 形成的“双 gap”结构。
- 对话区与预览区如果在设计稿中存在视觉间距，必须从 MCP 读取并分别作为左右 panel surface 的半侧 inset/padding，或使用经验证不会改变比例边界的布局方式。
- 不得把视觉间距重新做成“固定宽度 resizer column”。
- 50% 时左右逻辑轨道必须是真正 50:50；0px 边界不能偷走任何一侧宽度。
- `--sto-split-preview-col` 继续是唯一宽度来源；Header、Body、热区都基于同一个边界。

目标结构示意：

```text
┌──────────────── main unified grid ────────────────┐
│ chat header actions │0│ preview tabs/panel action │
├─────────────────────┼─┼───────────────────────────┤
│ chat body           │0│ preview body              │
└─────────────────────┴─┴───────────────────────────┘
                      ↑
      透明命中区 + 提示线（分层）对齐预览框左描边（逻辑分界 + inset-x）
```

### 5.4 拖拽热区 + `#FFD6BA` 提示线

新增或抽取共享组件，例如：

`src/components/layout/split-panel-resize-handle.tsx`

行为要求：

- grid placement：`col-start-2 row-start-1 row-span-2`；
- 通过共享 `--sto-split-preview-inset-x` 将命中区与视觉线一起偏移到预览框左描边（不得只移线不移热区）；
- 热区宽度不参与 Grid 布局；
- 工程默认热区 **12px**（`w-3`），不得退回 4px；
- `cursor: col-resize`；
- `no-drag`，避免 Electron Header 的 `drag-region` 吞掉事件；
- **命中壳层**始终透明，不渲染短灰线、胶囊线或壳层背景色；
- **视觉子层**固定 `bg-[#FFD6BA]`、`w-[2px]`，`pointer-events-none`；默认 `opacity-0`；`group-hover` / `data-resizing=true` / `group-focus-visible` 时 `opacity-100`；
- 竖向范围对齐预览 body inset（Header 高度 + inset-y → bottom inset-y），不贯穿 Header、不画到 Main 最底；
- Chat/Home 必须传入 `isResizing`（全屏 overlay 时不能只靠 `:hover`）；
- 不允许保留旧内部 `h-8 w-0.5` / `bg-muted-foreground` / `bg-primary` 短线；
- z-index 只需高于 Header/Body 内容，不能盖住 Dialog、Popover、Dropdown；
- 组件卸载或路由切换时必须结束拖拽并恢复 `userSelect`/cursor/overlay。

可访问性要求：

- 使用 `role="separator"`、`aria-orientation="vertical"`；
- 暴露当前百分比、最小值和最大值；
- 支持键盘左右方向键微调，方向必须与“预览区变宽/变窄”的实际行为一致；
- focus-visible 时建议显示提示线；不得使用短灰线冒充常驻分隔线。

如果键盘支持会使本任务超出当前组件能力，Cursor 必须在 Phase A 明确列出，但不能退回不可聚焦的 `<div onMouseDown>`。

### 5.5 拖拽事件模型

`use-split-panel-resize.ts` 保留以下正确设计：

- 拖动中用 DOM/CSS variable + `requestAnimationFrame` 更新，避免每像素触发 Chat 全树 React render；
- mouse/pointer up 时再将百分比写回 `setPreviewSplitPercent`；
- `clampPreviewPanelPercent` 继续限制 30%–70%；
- `ResizeObserver` 继续以 `<main>` 可用内容宽为基准；
- `--sto-split-preview-col` 只写在统一 Grid owner `<main>`。

需要调整：

- 改用 Pointer Events，覆盖 `pointermove`、`pointerup`、`pointercancel`；
- 可以保留全屏透明 overlay 以跨 iframe 稳定捕获事件，但 overlay 必须有集中 cleanup；
- hook 必须在 effect cleanup 中处理“拖拽中卸载”；
- 不新增无必要的 `useCallback`/`useMemo`；
- 不在 Header、Chat、Home 分别复制宽度计算；
- 不允许同时存在百分比、px、left/right 三套互相独立的边界状态。

### 5.6 视觉间距与拖拽热区必须分离

MCP 可能给出两个 panel 之间的视觉留白。Cursor 必须分别记录：

| 概念 | 来源 | 是否占布局宽度 |
| --- | --- | --- |
| 逻辑比例边界 | `--sto-split-preview-col` | 否 |
| 拖拽热区 | 工程默认 12px 或 MCP 交互标注 | 否，覆盖边界 |
| 面板视觉间距 | MCP | 可以，但不能作为 resizer column |
| 可见分隔线 | 用户已确认不要 | 不存在 |

禁止用一个 `width` 同时承担上述多个概念。

---

## 6. 建议修改文件

### 6.1 必须修改

| 文件 | 修改内容 |
| --- | --- |
| `src/components/layout/content-header-context.tsx` | 增加并传递 `panelActions` 语义槽；相等性检查和 display 返回值同步更新 |
| `src/components/layout/ContentHeader.tsx` | 三栏时把 `actions` 放到左列尾部，把 `previewTabs + panelActions` 放右列；双栏时顺序组合 |
| `src/pages/Chat/ChatSearchBar.tsx` | 将会话工具与预览面板工具拆成独立组件/节点；保留原 handler、Tooltip、aria 行为 |
| `src/pages/Chat/index.tsx` | 分别注入 `actions`/`panelActions`；使用共享 resize handle（透明命中 + 橙线）；删除短灰线 JSX |
| `src/pages/Home/HomeMainConversation.tsx` | 与 Chat 完全同源接线；删除重复短灰线 JSX |
| `src/lib/surfaces.ts` | Grid 中间列改 0px、header 左区 `w-full flex-1`、handle + edge surface；清理旧 4px/短灰线定义 |
| `src/hooks/use-split-panel-resize.ts` | Pointer Events、cleanup、统一边界同步；保持百分比持久化与 RAF |

### 6.2 建议新增

| 文件 | 职责 |
| --- | --- |
| `src/components/layout/split-panel-resize-handle.tsx` | Chat/Home 共用：透明命中区 + primary 橙线 + separator 语义 |
| `tests/unit/split-panel-layout.test.tsx` | Header 左区铺满、橙线可见、无短灰线、0px 轨道回归 |
| `tests/unit/split-panel-resize.test.ts` | clamp、方向、pointer cleanup 和百分比提交的可测试部分 |

测试文件可以结合当前测试能力合并，但不能完全依赖人工截图。

### 6.3 相关旧 surface 清理

Cursor 必须先 `rg` 证明无消费者，再处理：

- `stoSplitGridHeaderResizerClass`
- `stoSplitGridBodyResizerClass`
- 仍写死 `_4px_` 的 deprecated split grid template
- 仍描述“预览 tab 与 actions 同在右列”的过期注释

与本任务无关的 deprecated surface 不得顺手清理。

---

## 7. MCP 读取与映射清单

Cursor 收到 MCP 后，必须先输出下面的对照表，再开始实现：

| MCP 节点/元素 | 需要读取 | 映射目标 |
| --- | --- | --- |
| 双栏顶部操作区 | icon 顺序、尺寸、间距、右内距、hover/active | `ContentHeader` 双栏 actions |
| 三栏左侧顶部 | 三个 icon 与分栏边界距离、标题/工具间留白 | split chat header zone |
| 三栏右侧顶部 | 菜单、tab、预览开关顺序及内距 | split preview header zone |
| 对话/预览交界 | 是否有 panel gap、gap 精确值 | panel surface inset；不是 resizer width |
| 拖拽交互态 | 是否仅 cursor 变化、是否有 focus/drag feedback | resize handle state |
| 亮色/暗色 | 背景、hover、active、focus 对比 | 语义 token / `dark:` 校验 |

MCP 取不到时的规则：

- 位置语义、没有灰线/没有 4px 布局列、提示线 `#FFD6BA`/2px 与默认隐藏矩阵已经确认，不得回退。
- 预览 inset 取不到时使用本文确认的 10px / 8px，并由 CSS variable 共享。
- 透明热区若无标注，使用本文确认的 12px 工程默认。

---

## 8. 分步开发顺序

Cursor Auto 必须按以下顺序执行，每步结束后检查 diff，禁止一次性大改：

### Phase A：预检与规范校正

1. 读取本文、AGENTS.md、四个 `.cursor/rules`、`openspec/config.yaml`。
2. 读取 §3 中全部真实代码及所有消费者。
3. 通过 MCP 输出 §7 对照表。
4. 校正 `chat-file-preview-enhancement` 中 resize 相关 OpenSpec artifact。
5. 输出最终文件清单；若未超出 §6，直接进入 Phase B。

### Phase B：Header 语义拆槽

1. 给 `ContentHeaderSlot` 增加 `panelActions`。
2. 更新 Provider 相等性比较、`useContentHeader` 注册和 display 返回值。
3. 调整 `ContentHeader` 双栏/三栏组合。
4. 拆分 Chat 会话 actions 与 preview panel actions。
5. Chat/Home 两处接线。
6. 先运行 typecheck 和相关组件测试，确认 workflow editor、TaskDetail 等非 split 消费者不回归。

### Phase C：零宽边界与共享 handle

1. 将统一 Grid 中间轨道从 4px 改为 0px，并移除双 gap。
2. 更新 Header/Body preview grid placement，保证仍使用同一列宽变量。
3. 新增共享 resize handle，覆盖 row1+row2。
4. 删除 Chat/Home 的短灰线和重复 handle DOM。
5. 按 MCP 应用 panel 视觉间距，但不改变逻辑比例边界。
6. 验证 30/50/70 三个比例下 Header 和 Body 同线。

### Phase D：Pointer 与清理

1. 将 hook 改为 Pointer Events。
2. 加入 `pointercancel`、组件卸载、RAF、overlay、`userSelect` 的统一 cleanup。
3. 加入 separator aria/键盘行为。
4. 补单元测试。

### Phase E：视觉与回归

1. 按 MCP 校准 icon 间距、panel gap、focus/hover/active。
2. 检查 light/dark。
3. 检查 macOS 侧栏展开/收起及红绿灯避让。
4. 检查 Windows controls reserve。
5. 检查搜索框展开时只向左展开，不跨过分栏边界遮住 preview tabs。
6. 完成 §10 全部验收。

---

## 9. 实现禁止项

以下任一做法均视为不合格：

- 保留 `grid-template-columns: 1fr 4px preview`；
- 只删除 `h-8 w-0.5`，继续用原 4px hitbox；
- 把 4px 改成 8px/12px 后继续作为布局列；
- 用负 margin、translate、绝对 left 值搬三个 icon；
- 根据 `previewPanelPercent` 在 React 中另外计算 icon 坐标；
- 在 Chat 和 Home 分别维护两份 resize handle；
- 恢复短灰线作为 hover/active 状态，或把整条边界做成全状态不可见（漏掉设计稿橙线）；
- 引入第三方 resizable panel 依赖；
- 修改 `previewSplitPercent` 的 persist schema；
- 修改预览业务、通信链路或 Main/IPC；
- 顺手删除/改写与本任务无关的旧组件；
- 新增无必要的 `useCallback`、`useMemo` 或 `React.memo`；
- 修改依赖、lockfile、构建/打包/CI 配置。

---

## 10. 验收标准

### 10.1 顶部工具位置

- [ ] 双栏关闭预览时，搜索/刷新/思考/预览开关仍在内容 Header 右侧，顺序与 MCP 一致。
- [ ] 三栏打开时，搜索/刷新/思考位于左侧对话列右端，靠近分栏边界。
- [ ] 三栏打开时，预览开关位于右侧预览列尾部。
- [ ] 产物菜单与 tab 位于右侧预览列起始处。
- [ ] 搜索框展开方向仍向左，不挤坏 preview tabs。
- [ ] Windows controls reserve 和 macOS 红绿灯区域不被遮挡。

### 10.2 拖拽边界

- [ ] DOM/CSS 中不再存在占宽 4px 的 split resizer column。
- [ ] Chat/Home 不再渲染短灰色竖线。
- [ ] 默认看不到提示线；hover / dragging / focus-visible 显示 `#FFD6BA` 2px；无短灰线。
- [ ] 鼠标进入透明热区显示 `col-resize`；提示线与热区对齐预览框左描边，无横向错位。
- [ ] 会话三工具贴对话区右边界（Header 左区铺满第一列）。
- [ ] 拖拽中快速移动（overlay 覆盖）时提示线仍持续显示；松手离开后隐藏。
- [ ] 热区中心与 Header/Body 的真实比例边界完全一致。
- [ ] 热区跨 Header/Body 可拖，并带 `no-drag`。
- [ ] 50% 时逻辑宽度真正 50:50，不因 handle 宽度被吃掉。
- [ ] 30% 与 70% 极限准确夹取。
- [ ] 快速横向拖动、跨 iframe、移出内容卡时不丢事件。
- [ ] 拖拽中切换路由/关闭预览不会留下 overlay、禁选文本或 resize cursor。

### 10.3 复用范围

- [ ] Chat 页面正常。
- [ ] 首页 `HomeMainConversation` 正常。
- [ ] 由首页会话承载的任务子项正常。
- [ ] Workflow editor 的普通 Header actions 不受影响。
- [ ] TaskDetail 仅标题 Header 不受影响。
- [ ] 侧栏展开/收起两种状态均正常。

### 10.4 可访问性

- [ ] 所有 icon 继续有 Tooltip 和 `aria-label`。
- [ ] separator 可聚焦且有 orientation/value/min/max。
- [ ] 键盘方向键可以调整比例且不会越界。
- [ ] focus-visible 清晰但不形成常驻灰线。

---

## 11. 测试与检查命令

本任务不涉及通信路径，不需要 `comms:replay` / `comms:compare`。

推荐按顺序执行：

```bash
pnpm run typecheck
pnpm test -- split-panel
pnpm exec eslint \
  src/components/layout/ContentHeader.tsx \
  src/components/layout/content-header-context.tsx \
  src/components/layout/split-panel-resize-handle.tsx \
  src/pages/Chat/ChatSearchBar.tsx \
  src/pages/Chat/index.tsx \
  src/pages/Home/HomeMainConversation.tsx \
  src/hooks/use-split-panel-resize.ts \
  src/lib/surfaces.ts \
  --max-warnings=0
```

说明：

- 如果测试文件最终未使用 `split-panel` 命名，改为运行对应真实测试文件，不要运行空过滤器后误判成功。
- `pnpm run lint` 可能自动修复全仓文件，本任务优先使用不带 `--fix` 的定向 ESLint。
- 不运行安装命令。
- 不在当前工作区执行 build/package；AGENTS.md 要求构建只能从指定 source project 进行，本任务本身不需要构建。

人工验证必须使用 Electron 实际页面或已配置的浏览器/应用 MCP，不以 jsdom 布局结果替代。

---

## 12. 截图验收矩阵

Cursor 必须为以下组合保留截图或明确验收记录：

| 侧栏 | 预览 | 比例 | 搜索 | 主题 | 平台重点 |
| --- | --- | --- | --- | --- | --- |
| 展开 | 关闭 | — | 关闭 | light | 四个入口顺序 |
| 展开 | 打开 | 50/50 | 关闭 | light | 三个 icon 移到左列 |
| 展开 | 打开 | 30/70 | 关闭 | light | 左极限、边界同线 |
| 展开 | 打开 | 70/30 | 打开 | light | 搜索展开不越界 |
| 收起 | 打开 | 50/50 | 关闭 | light | 红绿灯/展开钮避让 |
| 展开 | 打开 | 50/50 | 关闭 | dark | 无短灰线、橙线可见、命中壳无浅色残留 |
| 展开 | 打开 | 50/50 | 关闭 | light | Windows controls reserve |

至少覆盖一个 Chat 会话和一个 Home/任务子项会话。

---

## 13. Stop Rules

出现以下情况立即停止，不得继续补分支：

1. MCP 展示的顶部工具归属与本文确认结论冲突。
2. 去掉 4px 列后发现还有第三个未识别的 split consumer。
3. 需要修改 `settings.ts` persist schema 才能完成。
4. 需要修改 `Sidebar.tsx`、Main/IPC、Gateway 或预览业务逻辑。
5. 为定位 handle 需要新增第二套 left/right/percent React state。
6. 同一错位连续修改三次仍未解决。
7. Pointer/overlay cleanup 测试无法稳定通过。
8. OpenSpec 旧 change 无法安全校正且会破坏尚未完成的工作。

停止时必须输出：阻塞点、已完成结果、涉及文件、两种可选处理方式，不得自行扩大范围。

---

## 14. 文档与交付

实现完成后：

1. review `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需要同步。
2. 本次仅修正既有三栏交互，通常不需要改 README；如不改，在交付说明中记录“已 review，无需更新”。
3. 更新 `.cursor/rules/02-styles.mdc` 的前提是 MCP 确认形成可复用规则；单页面精确值不要直接升级成全局规则。
4. 最终交付必须列出：修改文件、结构决策、测试结果、MCP 对照结果、剩余风险。

---

## 15. 可直接给 Cursor Auto 的启动提示词

```text
请阅读并严格执行：

@docs/三栏工具区与无痕拖拽边界-Cursor开发文档.md
@AGENTS.md
@.cursor/rules/00-workflow-and-risk.mdc
@.cursor/rules/01-code-rules.mdc
@.cursor/rules/02-styles.mdc
@.cursor/rules/05-engineering-guardrails.mdc
@openspec/config.yaml

这是 Tier 2 局部结构重构，方案已经确认：

1. 三栏时搜索、刷新、思考三个会话工具放到左侧对话列右端。
2. 预览开关留在右侧预览列。
3. 不保留任何占布局宽度的 4px resizer column。
4. 不显示短灰色分隔线。
5. 使用 0px 逻辑边界 + 覆盖式透明拖拽热区（不占布局宽度）+ 对齐预览框左描边的 `#FFD6BA`/2px 提示线（默认隐藏）。
6. 保留现有 30%–70%、默认 50%、previewSplitPercent 持久化和统一 Grid。

我会提供设计稿 MCP。先执行文档 Phase A：

- 读取 MCP 并输出节点/精确值/token 对照表；
- 核对真实代码和全部消费者；
- 校正 chat-file-preview-enhancement 中 resize 相关 OpenSpec；
- 输出最终文件清单。

如果没有触发 Stop Rules，不需要再次向我确认方案，直接按 Phase B → E 小步实施。每一步完成后运行对应测试并检查 diff。

禁止：负 margin/translate 搬 icon、保留或扩大 4px 布局列、只删灰线留旧 hitbox、引入依赖、修改 lockfile/构建/CI、修改消息/预览/通信业务。

最终给我：

1. MCP 对照表
2. OpenSpec 修改摘要
3. 代码修改清单与关键结构说明
4. 自动测试结果
5. 截图验收矩阵结果
6. README 三语 review 结果
7. 未解决风险（没有则写无）
```
