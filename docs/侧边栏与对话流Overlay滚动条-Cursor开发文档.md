# 侧边栏与对话流 Overlay 滚动条 · Cursor T2 开发文档

> 适用工作区：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 执行模型：Cursor Auto
>
> 风险等级：Tier 2（中风险）
>
> 当前状态：已确认采用应用自有 Overlay Scrollbar（方案 C），按阶段实施；本文不授权一次性改造全应用所有滚动区。

## 0. Cursor 执行方式

### 0.1 开始前必须读取

按顺序完整读取：

1. 根目录 `AGENTS.md`。
2. `.cursor/rules/README.md`。
3. `.cursor/rules/00-workflow-and-risk.mdc`。
4. `.cursor/rules/05-engineering-guardrails.mdc`。
5. `.cursor/rules/01-code-rules.mdc`。
6. `.cursor/rules/02-styles.mdc`。
7. `openspec/config.yaml`。
8. 本文“当前代码事实”列出的源码和测试。
9. 相关现有变更：
   - `openspec/changes/sidebar-section-sticky-interactions/`
   - `openspec/changes/chat-file-preview-enhancement/`

开始前执行：

```bash
git status --short
```

所有未提交修改均属于用户。不得覆盖、回退、整文件重写或格式化与本任务无关的内容。

### 0.2 T2 执行节奏

- 本文已经完成方案比较并记录已确认推荐方案；若真实代码没有出现新冲突，Cursor 不需要重新发散产品范围。
- 先完成 OpenSpec，再进入代码任务。
- 一次只完成一个编号任务；每项完成后立即测试、检查 diff，再进入下一项。
- 不允许把共享原件、侧边栏、普通对话、全部对话变体和全局清理合并成一个补丁。
- 触发 Stop Rules 时停止实现，保留最后一个可验证状态，不继续堆叠 CSS、wrapper 或条件分支。
- 不创建分支、不提交、不推送，除非用户后续明确要求。
- 不执行构建或打包；本任务不涉及工程配置。
- 不新增依赖，不修改 `package.json`、lockfile、构建配置、脚本或 CI/CD。
- React 19 新代码不默认使用 `useCallback`、`useMemo` 或 `React.memo`。
- scroll 高频路径不得通过 React state 触发组件持续 render。

### 0.3 补丁保护

每次准备修改文件前执行：

```bash
git diff -- <file>
```

实施要求：

- 只使用小范围 patch 修改当前任务对应 hunk。
- 禁止整文件替换。
- 禁止 `git checkout --`、`git restore`、`git reset` 等回退命令。
- 禁止运行会自动修复全仓库的格式化或 lint 命令。
- 每个任务完成后分别检查该任务文件 diff。
- 最终执行 `git diff --check`。
- 交付时区分“本任务修改”和“原有用户修改”。

如果 patch 上下文不匹配，重新读取附近代码并缩小 patch，不得扩大覆盖范围。

## 1. 背景与问题

当前侧边栏和对话流已经接入轻量原生滚动条活动方案：

- `.sto-thin-scrollbar` 控制原生 WebKit scrollbar thumb 的透明与显示。
- `useNativeScrollbarActivity` 监听 pointer/scroll，并以 `120ms` 判断滚动停止。
- 侧边栏和对话流仍使用浏览器原生 scrollbar。
- 侧边栏 classic 模式和对话流仍保留 `scrollbar-gutter: stable`。

这一方案能控制“什么时候看见 thumb”，但无法解决以下布局问题：

1. 原生 classic scrollbar 或稳定 gutter 仍占用内容宽度。
2. 对话滚动 viewport 位于带 `20px` 水平 padding 的父容器内，thumb 无法贴主卡片最右边。
3. 侧边栏右侧 gutter 造成中部内容的左右有效空间不一致。
4. macOS 原生 overlay scrollbar 的效果受系统设置影响，Windows 通常仍使用占宽的 classic scrollbar。

用户确认的目标参考是应用内产物 HTML 预览：该页面运行在 Electron `webview` 内，根 viewport 铺满 frame，内部内容 padding 不会把系统 overlay scrollbar 推离右边。该效果是视觉参照，不是可直接跨平台复用的实现。

## 2. 目标与验收标准

### 2.1 核心目标

首批目标滚动面必须同时满足：

1. **贴边**：thumb 位于所属 surface 的最右边，不被父级内容 padding 推入内部。
2. **按活动显示**：空闲隐藏；滚动时立即显示；滚动停止且未直接操作 scrollbar 时快速淡出。
3. **不占位置**：thumb 作为 overlay 绘制，不参与 flex/grid 布局，不改变内容宽度。
4. **跨平台一致**：macOS 和 Windows 均由应用控制主要视觉与活动行为，不依赖系统 scrollbar 是否 overlay。
5. **原有滚动语义不变**：滚轮、触控板、键盘、拖动、程序滚动、自动滚底继续可用。

### 2.2 活动状态

目标行为：

```text
无溢出
└─ track / thumb 完全隐藏且不可交互

存在溢出
├─ idle：隐藏
├─ scroll：立即显示
├─ scroll 连续发生：持续显示并更新位置
├─ 连续 120ms 无 scroll：视为停止
├─ stop 且未 hover/drag thumb：进入约 150ms 淡出
├─ hover/drag thumb：保持显示
└─ pointer release/leave 且已停止：淡出
```

说明：

- `120ms` 是识别滚动停止的技术 debounce，不是额外停留时间。
- 不使用此前讨论过的 `2s` inactivity delay。
- 普通内容区域仅 hover 不要求显示；直接接近 scrollbar 命中区、滚动或拖动才显示。
- 程序滚动导致实际 `scrollTop` 变化时可以显示，行为与原生 overlay scrollbar 一致。
- `prefers-reduced-motion: reduce` 下取消或显著缩短淡入淡出。

### 2.3 首批覆盖范围

按顺序覆盖：

1. 侧边栏“项目 / 任务 / 最近”中部滚动区。
2. 普通非 split Chat 对话流。
3. 首页对话流和任务子项对话流。
4. 双栏/三栏 split Chat。
5. 内嵌浏览器 Chat。

### 2.4 明确不做

- 不改造应用所有 `overflow-auto` / `overflow-y-auto`。
- 不改 Dropdown、Select、时间选择器、Textarea、短列表 Modal。
- 不改代码块和文件预览的横向滚动条。
- 不修改产物 HTML `webview` 内部网页样式。
- 不修改 Main/Gateway/IPC/host-api/持久化。
- 不改变 Chat 自动滚底、用户离底、跳转最新的产品语义。
- 不改变侧边栏项目/任务 sticky 和自动收起规则。
- 不顺手调整页面级 MainLayout、Settings、Skills、Models 等其他滚动面。
- 不在本变更中动态取消最近会话 `48px` 或项目行 `64px` 的行尾操作预留；该预留用于避免 hover 时标题跳动。

## 3. 当前代码事实

Cursor 必须以真实代码为准，实施前重新核对行号和消费者。

| 文件 | 当前职责与约束 |
| --- | --- |
| `src/hooks/use-native-scrollbar-activity.ts` | 当前原生 scrollbar 活动监听；`SCROLL_STOP_MS = 120`，直接修改 DOM attribute，不触发 React render |
| `tests/unit/use-native-scrollbar-activity.test.ts` | 当前活动 Hook 测试；迁移前不得直接删除 |
| `src/styles/globals.css` | 全局 8px scrollbar、`.sto-thin-scrollbar` 6px thumb、侧边栏 classic gutter |
| `src/lib/scrollbar-layout.ts` | 启动时检测 `classic / overlay`，设置 `data-scrollbar-layout` |
| `src/lib/surfaces.ts` | `stoChatScrollPaneClass`、`sidebarScrollContainerClass`、MainCardBody padding/gutter、侧边栏共享 surface |
| `src/components/layout/Sidebar.tsx` | 唯一侧边栏中部 viewport、sticky refs、自动收起 Hook 和活动 Hook 接入 |
| `src/hooks/use-sidebar-section-scroll-collapse.ts` | 监听侧边栏真实 viewport；实现项目/任务越界自动收起 |
| `src/pages/Chat/index.tsx` | 普通 Chat 的真实 `scrollRef`、自动滚底和 split 布局入口 |
| `src/pages/Home/HomeMainConversation.tsx` | 首页/任务会话的真实 `scrollRef`、自动滚底、split 入口 |
| `src/components/sclaw-browser/SclawBrowserEmbedChat.tsx` | 内嵌浏览器 Chat 的真实 `scrollRef` |
| `src/hooks/use-stick-to-bottom-instant.ts` | Chat 初始定位和 `use-stick-to-bottom` 包装，scrollRef owner |
| `src/hooks/use-chat-scroll-follow.ts` | 用户离底、流式跟随、跳转最新；本任务必须保持语义不变 |
| `src/components/chat/chat-conversation-column.tsx` | Chat/Home 对话列布局壳 |
| `src/components/layout/MainLayout.tsx` | provincial 主卡片 body；当前普通 body 使用 `stoMainCardBodyClass` |
| `src/components/sclaw-browser/SclawBrowserFrame.tsx` | 产物/网页预览的独立 webview/iframe；只作为视觉参照 |
| `src/components/sclaw-browser/sclaw-browser-overlay.css` | webview frame 铺满容器的样式事实 |

已确认结构问题：

- `stoChatScrollPaneClass` 当前包含 `[scrollbar-gutter:stable]`。
- 普通 Chat 非 split 分支也直接包含 `[scrollbar-gutter:stable]`。
- `stoMainCardBodyClass` 同时包含 `px-[var(--sto-content-pad-x)]` 和 `[scrollbar-gutter:stable]`。
- `--sto-content-pad-x` 当前为 `20px`。
- 侧边栏展开态在 scroll viewport 上使用 `px-2`，classic 模式另有稳定 gutter。
- 当前全局 scrollbar CSS 仍服务大量未纳入本变更的滚动区，不能全局删除。

## 4. 方案比较与已确认决策

### 4.1 方案 A：继续样式化原生 scrollbar

实现：保留 `::-webkit-scrollbar`，通过透明 thumb 和活动 attribute 控制显隐。

优点：

- 修改少。
- 现有代码已实现。

缺点：

- Windows classic scrollbar 仍可能占宽。
- stable gutter 即使 thumb 透明也仍保留。
- 无法跨越父容器 padding 贴到 surface 边缘。

结论：不满足“不占位置”，不继续作为最终方案。

### 4.2 方案 B：按平台混用原生 overlay 和自绘 scrollbar

实现：macOS overlay 环境使用系统 scrollbar；classic 环境使用应用自绘 scrollbar。

优点：

- macOS 改动较少。

缺点：

- 两套行为和测试路径。
- macOS“始终显示滚动条”会进入另一套路径。
- 长期维护成本高，细节难保持一致。

结论：不采用。

### 4.3 方案 C：共享应用级 Overlay Scrollbar

实现：保留真实滚动 viewport，隐藏其原生 scrollbar；在同一 relative wrapper 上渲染绝对定位的 track/thumb。

优点：

- thumb 不参与布局。
- macOS/Windows 视觉和行为统一。
- 可以贴所属 surface 最右边。
- 可复用现有 scrollRef 和活动检测思想。

风险：

- 需要正确处理 thumb 几何、ResizeObserver、拖动和多个现有 scroll listener。
- Chat 需要把 viewport 与内容 padding 分层。

**已确认采用方案 C。**

## 5. 推荐架构

### 5.1 组件职责

推荐新增：

```text
src/components/ui/overlay-scrollbar.tsx
src/hooks/use-overlay-scrollbar.ts
src/lib/overlay-scrollbar-metrics.ts
tests/unit/overlay-scrollbar-metrics.test.ts
tests/unit/use-overlay-scrollbar.test.tsx
```

职责分离：

- `overlay-scrollbar-metrics.ts`
  - 纯函数计算 thumb 长度和位移。
  - 不访问 DOM，便于覆盖边界测试。
- `use-overlay-scrollbar.ts`
  - 监听 scroll、resize、pointer drag。
  - 管理 DOM attribute、style 和 timer/rAF。
  - 不在 scroll 高频路径使用 React state。
- `overlay-scrollbar.tsx`
  - 只渲染 track/thumb。
  - 接收现有 `viewportRef`，不成为 scroll owner。

推荐组合方式：

```tsx
<div className="relative min-h-0 flex-1">
  <div ref={existingScrollRef} className="...真实 viewport...">
    <div className="...内容 padding / max-width...">...</div>
  </div>
  <OverlayScrollbar viewportRef={existingScrollRef} />
</div>
```

硬性要求：

- wrapper 不滚动。
- viewport 是唯一纵向滚动 owner。
- `scrollRef` 继续绑定 viewport。
- OverlayScrollbar 是 viewport 的 sibling，不创建第二个 scroll container。

### 5.2 thumb 几何

基础计算：

```text
overflow = scrollHeight > clientHeight
ratio = clientHeight / scrollHeight
thumbHeight = clamp(trackHeight * ratio, minThumbHeight, trackHeight)
maxScrollTop = scrollHeight - clientHeight
maxThumbTop = trackHeight - thumbHeight
thumbTop = maxScrollTop > 0 ? scrollTop / maxScrollTop * maxThumbTop : 0
```

边界要求：

- 无溢出时隐藏 track/thumb。
- `scrollHeight <= clientHeight` 不得出现除零、NaN 或负值。
- viewport resize、内容流式增长、侧边栏展开/收起后重新计算。
- thumb 最小视觉高度和命中区分离，具体值以现有紧凑桌面 UI 验证为准。
- thumb 位移使用 transform，避免每帧触发布局。

### 5.3 活动和性能

- scroll listener 必须 passive。
- 使用 requestAnimationFrame 合并同一帧的几何更新。
- 使用 ResizeObserver 观察 viewport 和内容尺寸变化。
- 组件卸载或 viewport 替换时必须释放 listener、observer、timer、pointer capture 和 rAF。
- 不覆盖既有 `onscroll`；使用独立 `addEventListener`。
- 不改变 `useSidebarSectionScrollCollapse` 和 `useChatScrollFollow` 的 listener。
- Chat 流式增长期间不得按 token 触发 React render。

### 5.4 拖动

- track 提供比视觉 thumb 更宽的透明命中区。
- pointerdown 后使用 pointer capture。
- 拖动距离按 `maxScrollTop / maxThumbTop` 映射到 `scrollTop`。
- pointerup、pointercancel、窗口失焦和卸载必须释放拖动状态。
- 拖动过程中 thumb 保持显示。
- 不禁止滚轮、触控板和键盘滚动。

### 5.5 可访问性

- 真实 viewport 保持原生滚动语义。
- Overlay thumb 是原生 scrollbar 的替代可视控制时，应评估 `role="scrollbar"`、`aria-orientation`、`aria-controls`、`aria-valuemin/max/now`。
- 若引入可聚焦 scrollbar，必须支持 Arrow、PageUp/PageDown、Home/End，并提供可见 focus。
- 如果最终将 overlay 定义为冗余指针增强而 `aria-hidden`，必须确认键盘用户仍能聚焦并滚动真实 viewport；不得同时隐藏所有可访问滚动入口。
- Windows `forced-colors: active` 下优先可用性；允许恢复清晰的系统 scrollbar，而不是强求视觉一致。
- reduced motion 下不执行非必要淡入淡出。

## 6. OpenSpec 前置任务

代码修改前创建：

```text
openspec/changes/overlay-scrollbar-surfaces/proposal.md
openspec/changes/overlay-scrollbar-surfaces/design.md
openspec/changes/overlay-scrollbar-surfaces/tasks.md
openspec/changes/overlay-scrollbar-surfaces/specs/overlay-scrollbar-surfaces/spec.md
```

要求：

- Change ID：`overlay-scrollbar-surfaces`。
- New Capability：`overlay-scrollbar-surfaces`。
- Modified Capabilities：若核对现有 published specs 后没有必须修改的规范，明确写 `None`；不要为了形式重复 chat/sidebar 业务语义。
- proposal 聚焦为什么原生 scrollbar/gutter 无法满足跨平台目标，不写逐行实现。
- design 的每个关键决策写 rationale 和至少一个 alternative。
- risks 使用 `[Risk] → Mitigation`。
- spec 每个 Requirement 使用 SHALL/MUST，并至少包含一个 `#### Scenario:`。
- 每个 UI Requirement 包含 light/dark、Windows/macOS 和 reduced-motion/forced-colors 中适用的验收。
- tasks 按本文分阶段编号，每项引用 Requirement 名称。
- 不涉及 API、IPC、Gateway、Main 能力、持久化和通信链路。

OpenSpec 至少包含：

1. `Overlay scrollbar does not consume layout width`
2. `Overlay scrollbar reflects viewport geometry`
3. `Overlay scrollbar appears during scrolling and hides when idle`
4. `Overlay scrollbar supports pointer dragging and keyboard-accessible scrolling`
5. `Sidebar retains one scroll viewport and sticky behavior`
6. `Chat retains existing follow and user-scroll behavior`
7. `Target surfaces align scrollbars to their right edge`
8. `Non-target scroll surfaces remain unchanged`
9. `Light dark reduced-motion and forced-colors remain usable`

完成 OpenSpec 自检后再进入开发任务 1。

## 7. 分阶段开发任务

### 开发任务 1：共享 Overlay Scrollbar 原件

只实现共享原件和测试，不接入任何生产 consumer。

目标：

- 完成纯几何计算。
- 完成 scroll/resize 活动更新。
- 完成拖动能力。
- 完成无溢出、短内容、长内容、viewport resize、内容增长处理。
- 完成 light/dark/reduced-motion/forced-colors 的基础样式。

禁止：

- 不修改 Sidebar、Chat、Home、MainLayout。
- 不删除 `.sto-thin-scrollbar` 或旧活动 Hook。
- 不新增演示路由或新页面。

定向测试至少覆盖：

- `scrollHeight === clientHeight`。
- 极长内容的最小 thumb。
- scrollTop 0 / 中间 / 最大值。
- resize 后重新计算。
- 连续 scroll rAF 合帧。
- 120ms stop 检测。
- pointer drag 映射。
- unmount cleanup。

完成后检查：

```bash
pnpm test -- tests/unit/overlay-scrollbar-metrics.test.ts tests/unit/use-overlay-scrollbar.test.tsx
pnpm run typecheck
git diff --check
```

若项目现有 test script 参数形式不同，以 `package.json` 的真实 script 为准，但不得安装或升级依赖。

### 开发任务 2：侧边栏试点接入

只接入侧边栏，作为第一个真实 consumer。

目标结构：

```text
Sidebar 中部 relative wrapper
├─ 唯一 scroll viewport
│  └─ 项目 / 任务 / 最近内容
└─ OverlayScrollbar，right: 0
```

要求：

- `scrollContainerRef` 继续绑定真实 viewport。
- 侧边栏仍然只有一个中部纵向滚动容器。
- 项目、任务、最近 sticky 全部仍位于该 viewport。
- 保留 `useSidebarSectionScrollCollapse` 的真实元素和阈值语义。
- 移除侧边栏 consumer 的原生可见 scrollbar 和 classic stable gutter。
- 内容 padding 与 viewport 分层；thumb 不受内容 padding 影响。
- 不改变项目、任务、最近的数据、排序、展开 map 和菜单。
- 不同时接入 Chat。

验收：

- thumb 贴侧边栏 surface 最右边。
- thumb 显隐不改变列表宽度。
- 滚轮、触控板、拖动正常。
- 折叠/展开正常。
- 三级 sticky 和自动收起正常。
- 无内容溢出时无 thumb。
- light/dark 可读。
- macOS 和 Windows 实机至少各完成一次验证；没有对应环境必须如实记录。

### 开发任务 3：侧边栏水平基准对齐

必须在任务 2 完成并截图后再决定具体数值，不与任务 2 合并。

目标：

- 消除右侧 gutter 后重新测量真实剩余偏差。
- 统一品牌区、主导航、分区标题、中部列表和底部账户区的外层水平 inset。
- 保持 macOS Chrome 红绿灯安全区 `pl-20`，不把 chrome 行强行几何居中。

需要核对：

- 品牌区外层 `px-2` 与内部 `pl-2/pr-[10px]`。
- 主导航外层 `px-2` 与行内 `px-[10px]`。
- 分区标题 actions 的右侧 padding。
- 最近会话 `pr-12` / 48px trailing slot。
- 项目行 `pr-16` / 64px trailing slot。
- 底部账户 `p-2` 和热区 `px-2.5`。

约束：

- 不为了“绝对对称”删除隐藏操作槽，导致 hover 时标题跳动。
- 如果要缩小 trailing slot，必须同时验证状态、置顶、菜单和项目双按钮。
- 新水平值优先使用侧边栏语义 token或共享 surface，不散落多个 1px 特例。

验收：

- 一级行外框左右基准一致。
- scrollbar 不再引起中部单边偏移。
- 标题 hover 前后不跳动。
- 长标题 truncate 稳定。
- 顶部 Chrome 安全区不受影响。

### 开发任务 4：普通非 split Chat 接入

只处理普通 Chat，不同时处理 Home/split/embed。

当前关键问题：

```text
Main card
└─ MainCardBody：水平 padding 20px
   └─ Chat scroll viewport
      └─ native scrollbar（因此离主卡片边缘至少 20px）
```

目标结构：

```text
Main card
└─ 全宽 Chat scroll wrapper / viewport
   ├─ 内层 reading track：保留 max-width 与水平 padding
   └─ OverlayScrollbar：贴主卡片右边
```

要求：

- 先确认 MainCardBody 与 Chat viewport 的唯一滚动 owner，禁止产生双纵向滚动。
- 仅对 Chat route/Chat surface 做必要 full-bleed 分层，不破坏其他使用 `stoMainCardBodyClass` 的页面。
- `scrollRef` 继续绑定 Chat viewport。
- 消息阅读轨宽度、输入框宽度和居中规则不变。
- 去掉 Chat consumer 的原生 scrollbar/gutter，但不删除其他页面的 gutter。
- 保持 `useStickToBottomInstant`、`useChatScrollFollow`、Jump to latest 和搜索定位行为。

验收：

- thumb 贴主卡片右边。
- 消息卡片和输入框没有变宽或偏移。
- 短对话无 thumb，长对话活动时显示。
- 流式回复自动跟随正常。
- 用户主动离底后不被强制拉回。
- 切换会话初始滚底不闪烁。

若出现外层/内层双滚动、scrollTop owner 不明确或连续三次补丁仍无法稳定，立即停止并回到布局设计，不继续增加负 margin 或 calc 特例。

### 开发任务 5：其他 Chat 变体逐个接入

按顺序独立接入并验证：

1. 首页对话 / 任务子项对话。
2. split Chat。
3. 内嵌浏览器 Chat。

要求：

- 复用同一个 OverlayScrollbar，不复制几何和活动逻辑。
- `stoChatScrollPaneClass` / split class 的职责保持清楚。
- split resize 30%–70% 极值下，thumb 仍贴本列 surface 右边。
- preview 开关和 resize 不改变当前会话 scrollTop。
- 内嵌 Chat 的 overlay 不影响旁边独立 `webview` 内的网页 scrollbar。
- 每接入一个 consumer 就测试和检查 diff，再进入下一个。

### 开发任务 6：过渡代码清理与最终验收

所有目标 consumer 稳定后再清理：

- 评估移除 `.sto-thin-scrollbar` 的目标 consumer 接入。
- 评估删除或收敛 `useNativeScrollbarActivity`。
- 若旧 Hook 已无消费者，连同测试一起删除；若仍有消费者，保留并准确更新注释。
- 删除目标 consumer 的 `scrollbar-gutter: stable`。
- 保留未纳入本变更的 MainLayout/Settings/Modal 等原生 scrollbar 和 gutter。
- 不删除全局 `::-webkit-scrollbar`，除非搜索全部消费者并另行确认。
- 更新 `src/lib/surfaces.ts` 中“scrollbar 贴边”的过期注释。
- 按 AGENTS.md 检查 README 是否需要同步；当前仓库只有 `README.md` 时，不为本任务凭空创建多语言 README。
- 验收稳定后，再判断是否将 overlay 使用准则反哺 `.cursor/rules/02-styles.mdc`；不要在试点未完成时提前写成全局规则。

## 8. 测试矩阵

### 8.1 单元测试

- thumb 几何纯函数。
- 无溢出隐藏。
- viewport/content resize。
- scroll 活动和停止。
- pointer drag。
- repeated scroll / repeated resize 不泄漏 listener。
- unmount/ref 变化 cleanup。
- reduced motion 分支可被样式或属性验证。

### 8.2 侧边栏回归

- expanded / collapsed。
- 项目、任务、最近全部展开和全部收起。
- sticky 接力。
- 越界自动收起。
- 手动重新展开后的滚动揭示。
- 菜单、Tooltip、重命名、删除不受 overlay 命中区阻挡。
- 最底部账号区域不被 track 覆盖。

### 8.3 Chat 回归

- 空会话、短会话、长会话。
- 初次进入会话。
- 切换会话。
- 流式回复。
- 用户向上浏览。
- Jump to latest。
- 搜索定位。
- split 开关和拖拽极值。
- 任务子项会话。
- 内嵌浏览器 Chat。

### 8.4 平台与视觉

| 场景 | macOS | Windows |
| --- | --- | --- |
| 短内容无 thumb | 必测 | 必测 |
| 滚轮/触控板/鼠标滚轮显示 | 必测 | 必测 |
| 停止后快速淡出 | 必测 | 必测 |
| 拖动 thumb | 必测 | 必测 |
| 亮色/暗色 | 必测 | 必测 |
| 100% 缩放 | 必测 | 必测 |
| 125%/150% 缩放 | 可选 | 必测 |
| reduced motion | 必测 | 必测 |
| forced colors | 不适用 | 必测 |
| 侧边栏折叠 | 必测 | 必测 |
| Chat 流式回复 | 必测 | 必测 |
| split 30% / 70% | 必测 | 必测 |

无法运行对应平台时，交付中必须写“未完成实机验证”，不得用 Chromium 理论兼容代替实测结论。

## 9. Stop Rules

出现任一情况立即停止当前任务：

- 同一问题连续修改 3 次仍未解决。
- 新增第二个纵向滚动 owner。
- `scrollRef` 不再指向原真实 viewport。
- 为贴边持续增加负 margin、重复 calc 或平台 if 分支。
- scroll 触发 React 高频 render 或流式回复明显掉帧。
- OverlayScrollbar 命中区阻挡列表按钮、菜单或 split resize。
- 侧边栏 sticky 阈值发生无法解释的变化。
- Chat 自动滚底或用户离底语义回归。
- Windows/macOS 必须使用两套不同组件才能工作。
- 修改范围扩大到未确认的页面级或紧凑滚动区。
- 测试持续失败或 diff 混入无关用户修改。

停止后：说明阻塞点、保留最后可验证状态、列出需要人工确认的布局或交互决策。

## 10. 建议提交拆分

仅在用户明确要求提交时使用；默认不自动 commit。

```text
docs: define overlay scrollbar surfaces
feat: add reusable overlay scrollbar primitive
feat: adopt overlay scrollbar in sidebar
style: align sidebar horizontal insets
feat: adopt overlay scrollbar in chat
feat: adopt overlay scrollbar across chat variants
test: complete overlay scrollbar regression coverage
```

每个提交必须可独立测试和回滚，不得混入 Toast、错误提示、会话业务或其他页面改动。

## 11. 最终交付格式

每个阶段交付必须包含：

1. 完成的任务编号。
2. 实际修改文件。
3. 滚动 owner 和 ref 是否变化。
4. gutter/padding 的处理方式。
5. 测试命令与结果。
6. macOS/Windows 实机验证状态。
7. light/dark/reduced-motion/forced-colors 验证状态。
8. 已知限制。
9. 本任务 diff 与原有用户 diff 的区分。
10. 下一阶段是否满足进入条件。

最终完成时必须明确确认：

- 目标 scrollbar 已贴所属 surface 右边。
- thumb 不占布局宽度。
- idle 隐藏、滚动显示、停止快速淡出。
- 侧边栏仍只有一个滚动 viewport。
- Chat 自动滚底和用户离底逻辑未改变。
- 非目标滚动区未被全局修改。
- 未新增依赖、接口、IPC、Gateway 或工程配置变更。
