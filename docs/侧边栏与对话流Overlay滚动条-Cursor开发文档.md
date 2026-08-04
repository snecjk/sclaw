# 侧边栏与对话流 Overlay 滚动条 · Cursor T2 开发文档

> 适用工作区：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 执行模型：Cursor Auto
>
> 风险等级：Tier 2（中风险）
>
> 当前状态：已确认采用应用自有 Overlay Scrollbar（方案 C），按阶段实施；本文不授权一次性改造全应用所有滚动区。
>
> 文档版本：v2（2026-07-31，已按“低能力模型可机械执行”补充固定决策、文件白名单、阶段门禁和单任务提示词）

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

### 0.4 低能力模型强制执行协议

本文不是“一次性全部实现”的提示词。每次 Cursor 会话只允许执行以下一种模式：

1. **OpenSpec 模式**：只创建或修改第 6 节指定的 OpenSpec 文件，不修改 `src/` 和测试。
2. **单任务实现模式**：只执行第 7 节中的一个开发任务，不提前做下一个任务。
3. **Review 模式**：只读代码、运行允许的检查并报告问题，不修改文件。

Cursor 在每次产生第一个 patch 前，必须先输出下面这份 Preflight；任一项无法确认时停止，不得猜测：

```text
当前任务编号：
本次目标：
真实滚动 owner：
必须保持不变的 ref：
允许修改文件：
当前用户未提交修改：
本次定向测试：
是否发现需要扩大范围：否（若为是，停止并说明）
```

执行硬约束：

- 一次只打开并修改当前任务白名单中的文件。
- 白名单外文件即使“顺手可以优化”也不得修改。
- 某任务出现“可选”“评估”“建议”时，优先采用本文 5.6 节的固定决策；不得重新设计另一套组件。
- 任何新增 wrapper 都必须先写清楚哪个元素滚动、哪个元素只定位、哪个元素只承载内容。
- 任意阶段不得同时保留两个可见纵向 scrollbar。
- 任意阶段不得通过给内容增加永久右侧空白来伪装 overlay。
- 如果测试基础设施不支持某个 DOM API，允许在测试中做最小 stub；不得为此修改 Vitest/Vite 配置。
- 完成当前任务后立即停止并按第 11 节交付，不得自动进入下一任务。

### 0.5 本次分支基线与用户补丁保护

本文在 `canyang-ui-flow6` 分支复核时，工作区已有以下用户修改：

```text
src/components/layout/sidebar-project-session-row.tsx
src/components/layout/sidebar-recent-session-row.tsx
```

这两处改动正在移除 active 行标题额外的 `font-medium`。它们不属于 Overlay Scrollbar 任务，必须保留。

- 若任务 1、2、4、5 涉及实现，不得修改这两个文件。
- 任务 3 若确实需要调整行尾预留，只能修改与水平 padding/trailing slot 直接相关的 class；不得恢复或改写用户的字重修改。
- Cursor 开始时仍须重新执行 `git status --short` 和相应 `git diff -- <file>`；若实际状态与本文记录不同，以当前工作区为准，并把新发现的用户修改加入保护清单。

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
2. 首页 `/` 当前真实 `HomeMainConversation` 非 split 对话流；任务子项切换 session 后也复用此入口。
3. `HomeMainConversation` 双栏/三栏 split 对话流。
4. 内嵌浏览器 Chat。

`src/pages/Chat/index.tsx` 当前不是运行时路由入口：`/chat` 在 `src/App.tsx` 中重定向到 `/`。除非后续代码核对能证明它重新成为可达 route，否则本任务不接入该旧页面，只保留其旧 Hook 依赖，避免做无效改造。

### 2.4 固定交互参数与默认决策

以下是本任务已经确认的实现基线。Cursor 不得自行换成另一组交互：

| 项目 | 固定值 / 固定行为 |
| --- | --- |
| 滚动停止识别 | 最后一次 `scroll` 后 `120ms` 无新事件即停止 |
| 停止后的停留 | `0ms`；停止被识别后立即取消 active，不再等待 2 秒 |
| 淡出 | CSS `opacity` 约 `150ms`；这是过渡时间，不是停留时间 |
| reduced motion | 不做淡入淡出，active 取消后立即隐藏 |
| hover 激活范围 | 只在右侧 scrollbar activation rail / thumb 上 hover 时显示；hover 整个内容区不显示 |
| track 点击 | 首版不实现点击 track 翻页或跳转；避免加入未确认交互 |
| thumb 拖动 | 必须实现 Pointer Events 拖动与 pointer capture |
| 原生滚动 | viewport 继续响应滚轮、触控板、键盘和程序化 `scrollTop` |
| 无溢出 | overlay 完全隐藏，activation rail 不拦截点击 |
| 视觉 track | 背景透明，不画常驻槽 |
| 初始视觉尺寸 | activation rail 宽 `10px`；thumb 宽 `6px`；rail 贴 `right: 0`；thumb 在 rail 内居中 |
| 最小 thumb | `32px`；若 track 本身更短则不得超过 track |
| 垂直 inset | track 顶底各 `4px`，计算几何时使用扣除 inset 后的真实 track 高度 |
| 初始颜色 | 复用现有 `.sto-thin-scrollbar` 的 light/dark active 与 hover 透明度，不新增品牌色 |
| forced colors | 隐藏自绘 overlay，并恢复目标 viewport 的原生 scrollbar，优先保证可用性 |
| 可访问性 | 首版 overlay 是 pointer 增强，不增加新的 Tab 停靠点；不添加 `role="scrollbar"`，真实 viewport 保留原生滚动语义 |

如果实机验收认为 `10/6/32/4px` 需要微调，只允许在共享原件中改一处语义常量或共享 class；不得在 Sidebar、Chat、Home 分别写不同值。

“停止就消失”的准确解释：最后一个 `scroll` 事件后需要 `120ms` 才能判定输入已经停止；判定完成的同一回调立即移除 active，随后只执行 `150ms` 的 opacity 淡出。不得再增加 inactivity/dwell timer。

### 2.5 明确不做

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
| `src/App.tsx` | 当前 `/chat` 重定向到 `/`；不得假设 `src/pages/Chat/index.tsx` 是可达页面 |
| `src/pages/Chat/index.tsx` | 保留的旧 Chat 页面实现；当前没有运行时 route consumer，本任务默认不接入 |
| `src/pages/Home/HomeMainConversation.tsx` | 当前首页和任务 session 的真实对话流，持有 `scrollRef/contentRef`、自动滚底和 split 入口 |
| `src/pages/Home/HomeAgentHubSurface.tsx` | 决定落地态/对话态，并在非 split 外层使用 `px-4 sm:px-6`；这是对话 scrollbar 贴边前必须拆分的 padding |
| `src/pages/Home/index.tsx` | Home 页外层仍有 `px-1 sm:px-2`，需在主对话 full-bleed 调整时验证落地态不回归 |
| `src/components/sclaw-browser/SclawBrowserEmbedChat.tsx` | 内嵌浏览器 Chat 的真实 `scrollRef` |
| `src/hooks/use-stick-to-bottom-instant.ts` | Chat 初始定位和 `use-stick-to-bottom` 包装，scrollRef owner |
| `src/hooks/use-chat-scroll-follow.ts` | 用户离底、流式跟随、跳转最新；本任务必须保持语义不变 |
| `src/components/chat/chat-conversation-column.tsx` | Chat/Home 对话列布局壳 |
| `src/components/layout/MainLayout.tsx` | provincial 主卡片 body；当前普通 body 使用 `stoMainCardBodyClass` |
| `src/components/sclaw-browser/SclawBrowserFrame.tsx` | 产物/网页预览的独立 webview/iframe；只作为视觉参照 |
| `src/components/sclaw-browser/sclaw-browser-overlay.css` | webview frame 铺满容器的样式事实 |

已确认结构问题：

- `stoChatScrollPaneClass` 当前包含 `[scrollbar-gutter:stable]`。
- 不可达的旧 `src/pages/Chat/index.tsx` 非 split 分支也直接包含 `[scrollbar-gutter:stable]`；这是保留代码事实，不是本任务 consumer。
- `stoMainCardBodyClass` 同时包含 `px-[var(--sto-content-pad-x)]` 和 `[scrollbar-gutter:stable]`。
- `--sto-content-pad-x` 当前为 `20px`。
- 当前真实 Home 对话外侧还叠加了 `Home/index.tsx` 的 `px-1 sm:px-2` 与 `HomeAgentHubSurface.tsx` 的 `px-4 sm:px-6`；只处理内部 scrollbar class 仍无法贴主卡片右边。
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

固定新增：

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

固定组合方式：

```tsx
<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <div ref={existingScrollRef} className="...真实 viewport min-h-0 flex-1 overflow-y-auto...">
    <div className="...内容 padding / max-width...">...</div>
  </div>
  <OverlayScrollbar viewportRef={existingScrollRef} contentRef={contentMeasureRef} />
</div>
```

硬性要求：

- Host 必须同时是受限高度的 flex item 和 flex column；缺少 `flex`/`flex-col` 会让 viewport 的 `flex-1` 失效，缺少 `overflow-hidden` 会导致消息越过 composer 边界。
- wrapper / Host 不滚动。
- viewport 是唯一纵向滚动 owner。
- `scrollRef` 继续绑定 viewport。
- OverlayScrollbar 是 viewport 的 sibling，不创建第二个 scroll container。

### 5.2 thumb 几何

纯函数对外接口固定为等价于下面的形状；命名可以按项目风格微调，但不得把 DOM 读取塞进纯函数：

```ts
export interface OverlayScrollbarMetricsInput {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  trackHeight: number;
  minThumbHeight?: number;
}

export interface OverlayScrollbarMetrics {
  hasOverflow: boolean;
  thumbHeight: number;
  thumbTop: number;
  maxScrollTop: number;
  maxThumbTop: number;
}

export function calculateOverlayScrollbarMetrics(
  input: OverlayScrollbarMetricsInput,
): OverlayScrollbarMetrics;
```

基础计算：

```text
overflow = scrollHeight > clientHeight
ratio = clientHeight / scrollHeight
thumbHeight = clamp(trackHeight * ratio, minThumbHeight, trackHeight)
maxScrollTop = scrollHeight - clientHeight
maxThumbTop = trackHeight - thumbHeight
safeScrollTop = clamp(scrollTop, 0, maxScrollTop)
thumbTop = maxScrollTop > 0 ? safeScrollTop / maxScrollTop * maxThumbTop : 0
```

边界要求：

- 无溢出时隐藏 track/thumb。
- `scrollHeight <= clientHeight` 不得出现除零、NaN 或负值。
- viewport resize、内容流式增长、侧边栏展开/收起后重新计算。
- thumb 最小视觉高度为 `32px`，命中 rail 宽度为 `10px`，视觉 thumb 宽度为 `6px`。
- thumb 位移使用 transform，避免每帧触发布局。
- 非有限值或负尺寸不得传播为 `NaN/Infinity`；统一降级为无溢出的零值结果。

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
- 本次把 overlay 定义为真实 viewport 之外的冗余 pointer 增强，不新增 Tab 停靠点，不实现第二套键盘滚动控制。
- overlay 容器使用 `aria-hidden="true"`，不添加 `role="scrollbar"`；键盘滚动仍由真实 viewport 和现有页面焦点路径承担。
- 不给 viewport 无条件增加 `tabIndex`。若实测发现现有页面完全无法通过键盘滚动，应触发 Stop Rule，单独确认焦点策略，不能让弱模型临时补一套 ARIA scrollbar。
- Windows `forced-colors: active` 下优先可用性；允许恢复清晰的系统 scrollbar，而不是强求视觉一致。
- reduced motion 下不执行非必要淡入淡出。

### 5.6 固定组件契约和 DOM 结构

本节用于消除实现歧义。除非真实类型无法兼容并触发 Stop Rule，组件对外契约固定为：

```ts
export interface OverlayScrollbarProps {
  viewportRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  className?: string;
}
```

说明：

- `viewportRef` 指向唯一真实滚动元素，用于读取 `scrollTop/clientHeight/scrollHeight` 和写入拖动后的 `scrollTop`。
- `contentRef` 指向 viewport 内部的单一内容测量根，用于 ResizeObserver 感知流式内容增长。
- Chat/Home/embed 必须复用 `useStickToBottomInstant` 已返回的 `scrollRef/contentRef`，不得创建替代 ref。
- Sidebar 保留 `useSidebarSectionScrollCollapse` 返回的 `scrollContainerRef`，只新增一个 `contentMeasureRef`；如需增加内容 wrapper，所有 sticky 标题仍须处于原 viewport 内。
- `className` 只用于定位差异，不允许 consumer 通过它覆盖 thumb 宽度、颜色、计时或交互。

固定结构：

```tsx
<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <div ref={viewportRef} className="sto-overlay-scroll-viewport min-h-0 flex-1 overflow-y-auto">
    <div ref={contentRef}>{/* 原有内容 */}</div>
  </div>
  <OverlayScrollbar viewportRef={viewportRef} contentRef={contentRef} />
</div>
```

三层职责不可交换：

```text
Host（relative flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden）：分配剩余高度、定位 overlay、裁剪越界；不滚动
viewport：唯一 scroll owner，保留原 scrollRef 和原 scroll 行为；min-h-0 flex-1 overflow-y-auto
content root：只承载原内容并提供尺寸观测，不设置 overflow-y-auto
```

Host 必须同时是受限高度的 flex item 和 flex column；缺少 flex/flex-col 会让 viewport 的 flex-1 失效，缺少 overflow-hidden 会导致消息越过 composer 边界。

OverlayScrollbar 自身固定使用这些 DOM 状态；不得给每个 consumer 发明不同 attribute：

```text
data-overflow="true|false"
data-active="true|false"
data-dragging="true|false"
```

推荐内部 ref：

```text
rootRef   → absolute overlay root
trackRef  → 10px transparent activation rail
thumbRef  → 6px visual thumb
```

固定状态逻辑：

```text
active = hasOverflow && (isScrolling || isRailHovered || isDragging)
```

- 这些状态放在 hook 内的 mutable ref 和 DOM attribute 中，不放进会随 scroll 高频更新的 React state。
- scroll/resize/content growth 只通过 rAF 合并后更新 `thumbRef.style.height` 与 `thumbRef.style.transform`。
- `pointerenter/leave` 只绑定 activation rail，不绑定整个 viewport。
- `pointerdown` 只绑定 thumb；透明 track 空白区不执行跳转。
- track 在 `data-overflow="false"` 时必须 `pointer-events: none`。
- custom overlay 默认 absolute `inset-y-0 right-0`，z-index 只高于滚动内容，不高于 Modal、Popover 或侧边栏菜单 portal。

原生 scrollbar 隐藏必须是 scoped class，不得改全局 selector：

```css
.sto-overlay-scroll-viewport {
  scrollbar-width: none;
}

.sto-overlay-scroll-viewport::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
```

forced-colors 下反向处理：隐藏 `.sto-overlay-scrollbar`，并让 `.sto-overlay-scroll-viewport` 恢复 `scrollbar-width: auto` 以及可见的 WebKit 原生 scrollbar。具体 WebKit 恢复写法若在 Electron 中不生效，停止并记录实测结果，不新增平台 JS 分支。

### 5.7 测试实现约束

- 几何测试只测 `src/lib/overlay-scrollbar-metrics.ts` 的纯函数，不依赖 jsdom 自动计算布局。
- Hook/组件测试使用 `Object.defineProperty` 明确注入 `clientHeight`、`scrollHeight`、`scrollTop` 和 `getBoundingClientRect()`。
- timer 使用 Vitest fake timers；必须验证 `120ms` 前仍 scrolling、到点后在非 hover/drag 状态移除 active。
- rAF 允许参照 `tests/unit/use-split-panel-resize.test.tsx` 做局部 stub。
- ResizeObserver 使用测试文件内最小 stub，验证 observe/disconnect 和回调后的几何更新；不得修改测试配置。
- Pointer capture 允许参照 `tests/unit/use-split-panel-resize.test.tsx` 的 `setPointerCapture/releasePointerCapture` stub。
- 测试必须在 `afterEach` 恢复 fake timers、global stub 和 DOM，避免污染全套单测。
- jsdom 不验证真实 scrollbar 是否占宽；贴边和不占位属于浏览器实机/E2E 验收。

## 6. OpenSpec 前置任务

本任务仍是 T2，不因为写 OpenSpec 自动升级为 T3。但它新增共享交互原件，并跨 Sidebar、Home Chat 和 Embed Chat 建立统一行为契约，符合 `.cursor/rules/05-engineering-guardrails.mdc` 中“Tier 2 涉及新能力或跨模块契约时使用 OpenSpec”的条件，因此本任务明确要求 OpenSpec。

本阶段文件白名单只有：

```text
openspec/changes/overlay-scrollbar-surfaces/proposal.md
openspec/changes/overlay-scrollbar-surfaces/design.md
openspec/changes/overlay-scrollbar-surfaces/tasks.md
openspec/changes/overlay-scrollbar-surfaces/specs/overlay-scrollbar-surfaces/spec.md
```

禁止在 OpenSpec 阶段修改 `src/`、`tests/`、`.cursor/rules/` 或已有 change。已有 change 只读参考，不得补写。

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
4. `Overlay scrollbar supports pointer dragging while native viewport scrolling remains keyboard accessible`
5. `Sidebar retains one scroll viewport and sticky behavior`
6. `Chat retains existing follow and user-scroll behavior`
7. `Target surfaces align scrollbars to their right edge`
8. `Non-target scroll surfaces remain unchanged`
9. `Light dark reduced-motion and forced-colors remain usable`

完成 OpenSpec 自检后再进入开发任务 1。

OpenSpec 阶段完成门禁：

- 四个文件全部存在，且没有其他文件 diff。
- `proposal.md` 明确 New Capabilities / Modified Capabilities。
- `design.md` 固定使用本文方案 C 和第 2.4 节参数，没有重新引入方案 A/B。
- `spec.md` 每个 Requirement 均有 `#### Scenario:`、`WHEN/THEN` 和 dark-mode 验收。
- `tasks.md` 使用编号标题、checkbox，并逐项引用 Requirement 名称。
- 输出 diff 摘要后停止，不开始任务 1。

## 7. 分阶段开发任务

### 开发任务 1：共享 Overlay Scrollbar 原件

只实现共享原件和测试，不接入任何生产 consumer。

文件白名单：

```text
src/components/ui/overlay-scrollbar.tsx
src/hooks/use-overlay-scrollbar.ts
src/lib/overlay-scrollbar-metrics.ts
src/styles/globals.css
tests/unit/overlay-scrollbar-metrics.test.ts
tests/unit/use-overlay-scrollbar.test.tsx
```

不允许修改白名单外文件。若其中某个新测试文件最终不需要，可以不创建；不得换成修改测试配置。

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

固定实施顺序：

1. 先写 `overlay-scrollbar-metrics.ts` 和纯函数测试。
2. 再写 `overlay-scrollbar.tsx` 的静态 DOM 和 scoped CSS，尚不接 consumer。
3. 再写 `use-overlay-scrollbar.ts`，按第 5.6 节连接 refs、attribute、rAF、ResizeObserver 和 Pointer Events。
4. 最后补 Hook/组件测试，验证 cleanup。
5. 检查 `rg -n "OverlayScrollbar" src` 的结果只能包含共享原件自身；出现 Sidebar/Home consumer 说明越界。

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

任务 1 完成门禁：定向测试、typecheck、diff check 全部通过；生产 consumer 数量为 0；然后停止。

### 开发任务 2：侧边栏试点接入

只接入侧边栏，作为第一个真实 consumer。

默认文件白名单：

```text
src/components/layout/Sidebar.tsx
src/lib/surfaces.ts
src/styles/globals.css
```

只有发现共享原件存在“在任务 1 测试中未暴露、但侧边栏接入必现”的直接缺陷时，才允许同时修改以下文件，并必须在交付中单独解释：

```text
src/components/ui/overlay-scrollbar.tsx
src/hooks/use-overlay-scrollbar.ts
src/lib/overlay-scrollbar-metrics.ts
tests/unit/overlay-scrollbar-metrics.test.ts
tests/unit/use-overlay-scrollbar.test.tsx
```

本任务明确禁止修改 `sidebar-project-session-row.tsx` 和 `sidebar-recent-session-row.tsx`，保护 0.5 节中的用户补丁。

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

固定实施顺序：

1. 在 `Sidebar.tsx` 为“项目 / 任务 / 最近”原内容增加一个单一 content measurement root 和 `contentMeasureRef`。
2. 在原 viewport 外增加 relative wrapper；wrapper 必须是现有 flex 布局中的 `min-h-0 flex-1` 占位者。
3. `scrollContainerRef` 仍绑定原 viewport；不得把它移到 wrapper 或 content root。
4. 给 viewport 接入 scoped 原生 scrollbar 隐藏 class，移除仅服务 classic gutter 的 consumer class/规则。
5. 在 wrapper 内、viewport 之后挂一个 `OverlayScrollbar` sibling。
6. 运行 `rg` 确认 `useSidebarSectionScrollCollapse` 没有改动，sticky 元素仍在同一 viewport 内。

验收：

- thumb 贴侧边栏 surface 最右边。
- thumb 显隐不改变列表宽度。
- 滚轮、触控板、拖动正常。
- 折叠/展开正常。
- 三级 sticky 和自动收起正常。
- 无内容溢出时无 thumb。
- light/dark 可读。
- macOS 和 Windows 实机至少各完成一次验证；没有对应环境必须如实记录。

检查命令：

```bash
pnpm test -- tests/unit/overlay-scrollbar-metrics.test.ts tests/unit/use-overlay-scrollbar.test.tsx tests/unit/sidebar-section-sticky.test.ts
pnpm run typecheck
git diff --check
```

任务 2 完成门禁：侧边栏截图和行为验收完成；Home/Chat 文件 diff 为 0；然后停止。

### 开发任务 3：侧边栏水平基准对齐

必须在任务 2 完成并截图后再决定具体数值，不与任务 2 合并。

本任务分成两个独立回合，不得一次完成：

- **任务 3A（只分析）**：只读代码和截图，输出测量表、拟修改文件和单一推荐数值，不写 patch，等待用户确认。
- **任务 3B（确认后实现）**：只实现用户确认的水平基准，不再改变 scrollbar 结构。

任务 3B 文件白名单必须从下面列表中按实际需要取最小子集，不得默认全部修改：

```text
src/components/layout/Sidebar.tsx
src/components/layout/sidebar-collapsible-section-label.tsx
src/components/layout/sidebar-projects-section.tsx
src/components/layout/sidebar-project-session-row.tsx
src/components/layout/sidebar-project-session-row-trailing.tsx
src/components/layout/sidebar-recent-session-row.tsx
src/components/layout/sidebar-recent-session-row-trailing.tsx
src/lib/surfaces.ts
src/styles/globals.css
```

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

任务 3A 输出的测量表必须至少包含：区域、左侧可视 inset、右侧可视 inset、差值来源、是否由 trailing slot 造成、建议是否修改。没有截图或无法测量时停止，不凭肉眼编造 1px/2px 修正。

任务 3B 修改 `sidebar-project-session-row.tsx` 或 `sidebar-recent-session-row.tsx` 前必须先读其现有 diff，只修改 padding/trailing slot 对应 hunk，不得恢复 `font-medium`。

### 开发任务 4A：当前 Home 对话 full-bleed 布局分层

本任务只解决“真实 scroll viewport 如何铺到主卡片右边”，暂不接入 OverlayScrollbar。这样可以先验证 layout owner，避免把布局错误和 scrollbar 交互错误混在同一个 patch 中。

文件白名单：

```text
src/components/layout/MainLayout.tsx
src/lib/surfaces.ts
src/pages/Home/index.tsx
src/pages/Home/HomeAgentHubSurface.tsx
src/pages/Home/home-hub-surface-styles.ts
```

不得修改 `src/pages/Chat/index.tsx`、`HomeMainConversation.tsx`、overlay 共享原件或 Embed Chat。

当前关键问题：

```text
Main card
└─ MainCardBody：水平 padding 20px
   └─ Home/index：px-1 / sm:px-2
      └─ HomeAgentHubSurface：px-4 / sm:px-6
         └─ HomeMainConversation scroll viewport
            └─ native scrollbar（因此离主卡片边缘存在多层 inset）
```

目标结构：

```text
Main card
├─ ContentHeader：保持原样
└─ Home 专用 full-bleed body（不滚动、无水平 padding、无 gutter）
   └─ Home 状态容器
      ├─ 落地态：内部重新应用原有视觉 inset
      └─ 对话态：scroll viewport 可铺到 body 右边
```

要求：

- 只为当前 `/` Home route 选择 Home 专用 body class；Models、Settings、Skills 等仍使用 `stoMainCardBodyClass`。
- Home 专用 body 使用 flex + `min-h-0/min-w-0/overflow-hidden`，不成为新的纵向 scroll owner。
- 同时检查 provincial sidebar 和 full sidebar 两条 `MainLayout` 分支；`/` 在两种 layout variant 下都不能继续由外层 main 抢占对话滚动，其他 route 的 outer scroll 行为不变。
- 落地态 Hero、推荐卡和底部输入的现有视觉宽度与 inset 必须在 Home 内部恢复，不能因为 full-bleed 变宽。
- 对话态移除位于真实 viewport 外侧的水平 padding；消息/输入的阅读轨 padding 留在 `stoChatColumnContentTrackClass` 等内层。
- 不使用负 margin、`right: -20px`、多层 `calc()` 或 portal 把 scrollbar 假装贴边。
- 本任务不删除原生 scrollbar，也不改 `scrollRef/contentRef`。

验收：

- `/` 落地态与任务前截图对比，Hero、推荐卡、输入框没有横向漂移。
- `/` 对话态的真实 viewport 右边界与主卡片 body 右边界一致。
- provincial/full sidebar 两种布局均只有对话 viewport 负责消息纵向滚动。
- 其他路由的 MainLayout padding/gutter 没有变化。
- 页面仍只有一个对话纵向 scroll owner。

若出现外层/内层双滚动、scrollTop owner 不明确或连续三次补丁仍无法稳定，立即停止并回到布局设计，不继续增加负 margin 或 calc 特例。

检查命令：

```bash
pnpm run typecheck
git diff --check
```

任务 4A 完成后停止，不自动接 OverlayScrollbar。

### 开发任务 4B：Home 非 split 对话接入 OverlayScrollbar

前置条件：任务 4A 已确认 viewport 能铺到主卡片右边，且落地态没有视觉回归。

默认文件白名单：

```text
src/pages/Home/HomeMainConversation.tsx
src/lib/surfaces.ts
src/styles/globals.css
```

共享原件文件只允许修复接入后发现的直接缺陷，规则与任务 2 相同。不得再修改 MainLayout/Home 外层布局。

固定步骤：

1. 使用现有 `scrollRef` 作为 viewportRef，现有 `contentRef` 作为 contentRef。
2. 在 viewport 外增加 relative wrapper，OverlayScrollbar 与 viewport 为 sibling。
3. 移除当前 Home consumer 的 `useNativeScrollbarActivity` 调用和 `sto-thin-scrollbar/[scrollbar-gutter:stable]` 接入。
4. 保留 `useStickToBottomInstant`、`useChatScrollFollow`、Jump to latest、搜索定位和输入框布局。
5. 非 split 模式完成后先测试，不顺手调整 split 分支。

验收：

- thumb rail 贴主卡片右边，消息阅读轨和输入框宽度不变。
- 短对话无 thumb；长对话滚动立即显示；停止判定后无停留地淡出。
- activation rail hover 显示，hover 内容区不显示。
- thumb 可拖动；滚轮、触控板、程序滚底正常。
- 用户主动离底后不被强制拉回；切换会话初始滚底不闪烁。

检查命令：

```bash
pnpm test -- tests/unit/overlay-scrollbar-metrics.test.ts tests/unit/use-overlay-scrollbar.test.tsx
pnpm run typecheck
git diff --check
```

### 开发任务 5：Home split 对话验证与接入

只处理 `HomeMainConversation` 的 split 状态，不处理 Embed Chat。

文件白名单：

```text
src/pages/Home/HomeMainConversation.tsx
src/components/chat/chat-conversation-column.tsx
src/lib/surfaces.ts
```

如果任务 4B 的 wrapper 天然同时覆盖 split，优先只做验证，不为“体现工作量”制造额外 diff。

要求：

- 复用同一个 `OverlayScrollbar` 实例模式，不复制几何和活动逻辑。
- `stoChatScrollPaneClass` / split class 的职责保持清楚。
- split resize 30%–70% 极值下，thumb 贴对话列 surface 右边，不贴整个主卡片右边。
- preview 开关和 resize 不改变当前会话 scrollTop。
- Overlay rail 不覆盖 split resize handle 和 preview 操作。
- 每次开关 preview 后重新计算 track/thumb 几何，不出现旧高度或旧位置。

任务 5 完成门禁：非 split 与 split 都通过回归；然后停止。

### 开发任务 6：内嵌浏览器 Chat 接入

只处理 Embed Chat，不修改旁边 webview/iframe 内网页。

文件白名单：

```text
src/components/sclaw-browser/SclawBrowserEmbedChat.tsx
src/components/sclaw-browser/sclaw-browser-overlay.css
src/lib/surfaces.ts
```

要求：

- 复用 Embed Chat 现有 `scrollRef/contentRef`。
- overlay 只属于 Embed Chat 列，不能附着到 `SclawBrowserFrame`。
- webview 内产物 HTML 的系统 scrollbar 完全不改。
- 关闭/切换 embed session 时 listener、observer、timer、rAF 全部释放。

任务 6 完成门禁：Embed Chat 与旁边网页可独立滚动，两个 scrollbar 不互相控制；然后停止。

### 开发任务 7：过渡代码清理

所有目标 consumer 稳定后再清理。本任务先执行只读搜索：

```bash
rg -n "useNativeScrollbarActivity|sto-thin-scrollbar|sidebar-scroll-container|scrollbar-gutter" src tests
```

默认文件白名单：

```text
src/hooks/use-native-scrollbar-activity.ts
tests/unit/use-native-scrollbar-activity.test.ts
src/lib/surfaces.ts
src/styles/globals.css
```

清理规则：

- 只删除目标 consumer 已不再需要的 `.sto-thin-scrollbar` 和 `scrollbar-gutter: stable` 接入。
- `src/pages/Chat/index.tsx` 当前仍引用 `useNativeScrollbarActivity`，且本任务默认不改旧页面，因此旧 Hook 和其测试默认保留。
- 只有 `rg` 证明旧 Hook 已经 0 consumer 时才允许删除 Hook 与测试；不得为了达到 0 consumer 去改不可达旧页面。
- 保留未纳入本变更的 MainLayout/Settings/Modal 等原生 scrollbar 和 gutter。
- 不删除全局 `::-webkit-scrollbar`。
- 更新 `src/lib/surfaces.ts` 中目标 surface 的过期注释。

### 开发任务 8：最终验收与文档同步

本任务默认只做验证和报告；只有确认 README 或 rules 存在与最终行为直接冲突的文字时才提出最小文档 patch。

最终检查：

- 运行共享原件定向测试、所有本任务新增测试和 `pnpm run typecheck`。
- `pnpm run lint` 当前会自动修复全仓库，默认不要运行；若用户明确要求 lint，先说明它可能产生无关修改，并在运行后逐文件检查 diff。
- 执行 `git diff --check`。
- 按第 8 节完成 macOS/Windows、light/dark、缩放、reduced-motion/forced-colors 矩阵。
- 检查 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否实际存在并需要同步；不存在的文件不创建。
- Overlay 模式经过 Sidebar、Home 非 split、Home split、Embed 实测稳定后，才评估把稳定准则反哺 `.cursor/rules/02-styles.mdc`；该 rules 修改必须单独获得用户确认，不能在本任务中自动完成。

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

- provincial sidebar / full sidebar。
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
refactor: make home conversation viewport full bleed
feat: adopt overlay scrollbar in home conversation
feat: support overlay scrollbar in split and embed chat
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

Cursor 必须使用下面的固定格式，未知项写“未验证”，不得省略或用“应该没问题”替代：

```text
任务编号：
结果：完成 / 部分完成 / 已停止
本任务修改文件：
原有用户修改文件：
唯一 scroll owner：
保留的 ref：
移除的 gutter / 外层 padding：
定向测试及结果：
typecheck 结果：
diff check 结果：
macOS 实机：通过 / 失败 / 未验证
Windows 实机：通过 / 失败 / 未验证
light / dark：
reduced motion / forced colors：
已知限制或阻塞：
是否允许进入下一任务：是 / 否；理由：
```

最终完成时必须明确确认：

- 目标 scrollbar 已贴所属 surface 右边。
- thumb 不占布局宽度。
- idle 隐藏、滚动显示、停止快速淡出。
- 侧边栏仍只有一个滚动 viewport。
- Chat 自动滚底和用户离底逻辑未改变。
- 非目标滚动区未被全局修改。
- 未新增依赖、接口、IPC、Gateway 或工程配置变更。

## 12. 可直接复制给 Cursor 的单任务提示词

使用规则：一次只复制一个提示词。不要把“OpenSpec + 任务 1～8”一起交给 Cursor。每次收到阶段交付后，人工检查 diff，再决定是否复制下一条。

### 12.1 OpenSpec 提示词

```text
请完整读取 AGENTS.md、.cursor/rules/README.md、00-workflow-and-risk.mdc、05-engineering-guardrails.mdc、01-code-rules.mdc、02-styles.mdc、openspec/config.yaml，以及 docs/侧边栏与对话流Overlay滚动条-Cursor开发文档.md。

现在只执行文档第 6 节“OpenSpec 前置任务”。先输出 0.4 节 Preflight。只允许修改 openspec/changes/overlay-scrollbar-surfaces/ 下列出的四个文件；不得修改 src、tests、rules、已有 change，不得开始开发任务 1。方案、参数、覆盖范围直接使用文档已确认结论，不重新发散。完成后按第 11 节格式交付并停止。
```

### 12.2 任务 1 提示词

```text
请读取项目 rules、已完成的 openspec/changes/overlay-scrollbar-surfaces/ 和开发文档。现在只执行“开发任务 1：共享 Overlay Scrollbar 原件”。先输出 Preflight，严格使用任务 1 文件白名单和第 5.2、5.6、5.7 节固定契约；不要接入 Sidebar/Home/Embed，不要修改任何 consumer。完成定向测试、typecheck、diff check 后按第 11 节交付并停止，不进入任务 2。
```

### 12.3 任务 2 提示词

```text
请读取项目 rules、OpenSpec、开发文档和 Sidebar 当前实现。现在只执行“开发任务 2：侧边栏试点接入”。先输出 Preflight，保护 git status 中全部用户改动，特别是不修改 sidebar-project-session-row.tsx 与 sidebar-recent-session-row.tsx。scrollContainerRef 必须继续指向唯一真实 viewport；只增加 contentMeasureRef、relative wrapper 和 OverlayScrollbar sibling。不得改 Home/Chat。完成定向测试、typecheck、diff check和侧边栏验收后按第 11 节交付并停止。
```

### 12.4 任务 3A 提示词

```text
现在只执行开发文档“任务 3A（只分析）”。禁止写 patch。读取任务 2 后的 Sidebar 结构、现有用户 diff 和最新截图，输出区域/左 inset/右 inset/差值来源/trailing slot/建议的测量表，给出最小文件范围和单一推荐方案。无法从代码或截图确定的数值标记为未测量，不猜测。输出后等待用户确认，不进入 3B。
```

### 12.5 任务 3B 提示词

```text
用户已经确认任务 3A 的水平基准方案。现在只执行开发文档“任务 3B”。先输出 Preflight，只修改用户确认的最小文件子集。修改两个 session row 前必须先读各自 git diff，只碰 padding/trailing slot hunk，不得恢复或改变已移除的 active font-medium。不得再改 scrollbar 结构。完成截图、长标题/hover/trailing actions 验收、typecheck和diff check后交付并停止。
```

### 12.6 任务 4A 提示词

```text
请先核对 src/App.tsx：/chat 当前重定向到 /，真实主对话入口是 HomeMainConversation。现在只执行“开发任务 4A：当前 Home 对话 full-bleed 布局分层”。先输出 Preflight，只使用任务 4A 文件白名单；不得修改 src/pages/Chat/index.tsx、HomeMainConversation 或 OverlayScrollbar。为 / 提供 Home 专用 full-bleed body，把落地态原视觉 inset 留在 Home 内部；不要用负 margin/calc/portal。验证落地态不漂移、对话 viewport 边界贴主卡片、其他路由无变化，然后交付并停止。
```

### 12.7 任务 4B 提示词

```text
前置条件是任务 4A 已通过。现在只执行“开发任务 4B：Home 非 split 对话接入 OverlayScrollbar”。先输出 Preflight，复用 HomeMainConversation 现有 scrollRef/contentRef，不创建替代 ref，不改 MainLayout/Home 外层。保持 useStickToBottomInstant、useChatScrollFollow、Jump to latest、搜索和用户离底语义。只验收非 split；完成定向测试、typecheck、diff check和交互验证后交付并停止。
```

### 12.8 任务 5 提示词

```text
现在只执行“开发任务 5：Home split 对话验证与接入”。先输出 Preflight，只使用任务 5 文件白名单。如果任务 4B 的结构已自然覆盖 split，则只验证并保持零或最小 diff，不复制 OverlayScrollbar 逻辑。必须检查 preview 开关、30%/70% resize、scrollTop 保持和 resize handle 命中。不要处理 Embed Chat。交付后停止。
```

### 12.9 任务 6 提示词

```text
现在只执行“开发任务 6：内嵌浏览器 Chat 接入”。先输出 Preflight，只修改 Embed Chat 白名单文件，复用其现有 scrollRef/contentRef。不得修改 webview/iframe 内产物网页，不得让 embed overlay 控制网页 scrollbar。验证两侧独立滚动和卸载 cleanup后交付并停止。
```

### 12.10 任务 7 提示词

```text
现在只执行“开发任务 7：过渡代码清理”。先做文档指定 rg 搜索并输出结果，再决定最小清理。src/pages/Chat/index.tsx 当前不是运行时入口但仍是旧 Hook consumer，默认保留 useNativeScrollbarActivity 和测试；不得为了删除 Hook 去改旧页面。不得删除全局 scrollbar。完成定向测试、typecheck、diff check后交付并停止。
```

### 12.11 任务 8 提示词

```text
现在只执行“开发任务 8：最终验收与文档同步”。默认 Review-only，不新增功能。按第 8 节矩阵和第 11 节格式逐项报告；未实测的平台明确写未验证。不要运行会自动修复全仓库的 lint，除非用户明确要求。README/rules 只有确认存在直接冲突时才提出最小 patch，并先说明文件与原因。完成后停止。
```
