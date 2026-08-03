## ADDED Requirements

### Requirement: Overlay scrollbar does not consume layout width

目标 surface 的自定义 Overlay Scrollbar MUST NOT 占用内容布局宽度。目标 viewport MUST 使用 scoped 方式隐藏原生可见 scrollbar / classic stable gutter；MUST NOT 依赖全局 `*` scrollbar 选择器完成隐藏。该行为 MUST 在 macOS 与 Windows 目标环境一致地避免 classic 占宽；light 与 dark 下均 MUST NOT 因 thumb 可见而改变内容宽度。

#### Scenario: Overflow content keeps full content width

- **WHEN** 目标 surface 内容高度超过 viewport 且出现垂直滚动
- **THEN** 内容区可用宽度 MUST 与无原生 classic scrollbar 占位时一致
- **AND** Overlay rail/thumb MUST 以 absolute 叠在 surface 右侧，不推动相邻列或文字换行宽度

#### Scenario: Scoped hide does not rely on global star selector

- **WHEN** 目标 viewport 应用 `.sto-overlay-scroll-viewport`
- **THEN** 原生可见 scrollbar MUST 被 scoped 隐藏
- **AND** MUST NOT 通过修改全局 `*` scrollbar 规则作为该 surface 的唯一隐藏手段

### Requirement: Overlay scrollbar reflects viewport geometry

Overlay thumb 的高度与位移 MUST 由真实滚动 viewport 的 `scrollTop`、`clientHeight`、`scrollHeight` 计算。Chat/Home/Embed MUST 复用既有 `scrollRef`/`contentRef`；Sidebar MUST 保留既有 `scrollContainerRef` 作为唯一 scroll owner，并可新增 `contentMeasureRef`。几何更新 MUST 在 light/dark 下使用同一算法。

#### Scenario: Thumb tracks scroll position

- **WHEN** 用户滚动目标 viewport
- **THEN** thumb 垂直位置 MUST 与 `scrollTop / (scrollHeight - clientHeight)` 对应
- **AND** thumb 高度 MUST 反映 `clientHeight / scrollHeight`，并遵守最小高度 32px（在轨道可绘制高度内夹紧）

#### Scenario: Content growth updates geometry

- **WHEN** 流式消息或列表内容增长导致 `scrollHeight` 变化
- **THEN** Overlay MUST 通过 content 根的尺寸观测更新 thumb 几何
- **AND** MUST NOT 创建替代真实 viewport 的第二滚动容器

### Requirement: Overlay scrollbar appears during scrolling and hides when idle

Overlay MUST 在存在溢出且（正在滚动、rail/thumb hover、或正在拖动）时显示；MUST 在最后一次滚动事件后 120ms 判定停止，并在非 hover/非 drag 时立刻移除 active，以约 150ms 透明度过渡淡出。MUST NOT 使用额外 2s dwell。`prefers-reduced-motion: reduce` 下显隐过渡 MUST 禁用或接近瞬时，但活动态判定 MUST 仍遵循 120ms stop。

#### Scenario: Scroll activity shows thumb

- **WHEN** 目标 viewport 存在溢出且用户开始滚动
- **THEN** Overlay MUST 进入 active 可见态（`data-active="true"`）

#### Scenario: Stop debounce hides thumb

- **WHEN** 用户停止滚动且 120ms 内无新的 scroll 事件，且未 hover rail/thumb、未拖动
- **THEN** Overlay MUST 立刻移除 active
- **AND** 视觉上以约 150ms opacity 过渡隐藏（reduced-motion 下可为瞬时）

#### Scenario: Hover keeps thumb visible after scroll stop

- **WHEN** 停止计时到达但指针仍在 activation rail 或 thumb 上
- **THEN** Overlay MUST 保持可见
- **AND** pointer leave 且非 dragging 后 MUST 隐藏

### Requirement: Overlay scrollbar supports pointer dragging while native viewport scrolling remains keyboard accessible

Overlay MUST 支持 thumb 指针拖动以写入真实 viewport 的 `scrollTop`。键盘 PageUp/PageDown/Home/End/方向键滚动 MUST 继续由原生 viewport 处理。v1 MUST NOT 在透明 track 空白区执行点击跳转。Overlay 根 MUST 使用 `aria-hidden`，MUST NOT 声明 `role="scrollbar"`。该指针增强在 light/dark 下 MUST 行为一致；macOS 与 Windows 均 MUST 支持 thumb 拖动。

#### Scenario: Thumb drag updates scrollTop

- **WHEN** 用户在 thumb 上 pointerdown 并拖动
- **THEN** 真实 viewport 的 `scrollTop` MUST 同步更新
- **AND** Overlay MUST 保持 dragging active 直至 pointerup

#### Scenario: Track gutter does not jump

- **WHEN** 用户点击透明 rail 上 thumb 以外区域
- **THEN** v1 MUST NOT 改变 `scrollTop`（不做页跳）

#### Scenario: Keyboard scrolling still works

- **WHEN** 焦点在可滚动内容路径上并使用键盘滚动快捷键
- **THEN** 原生 viewport MUST 滚动
- **AND** Overlay 几何 MUST 跟随更新

### Requirement: Sidebar retains one scroll viewport and sticky behavior

侧边栏中部滚动区 MUST 只有一个真实 overflow viewport。Sticky 分区标题与基于该 viewport 的自动收起逻辑 MUST 继续有效。相对定位 wrapper MUST NOT 成为滚动容器。

#### Scenario: Sticky headers remain inside viewport

- **WHEN** 用户滚动侧边栏中部列表
- **THEN** sticky 标题 MUST 仍相对于原 viewport 吸顶
- **AND** `scrollContainerRef` MUST 继续指向该唯一 viewport

#### Scenario: Auto-collapse still observes the same viewport

- **WHEN** 滚动位置变化触发 `useSidebarSectionScrollCollapse`
- **THEN** 行为 MUST 与接入 Overlay 前一致（观测同一 `scrollContainerRef`）

### Requirement: Chat retains existing follow and user-scroll behavior

Home 与 Embed 对话 MUST 保持 `useStickToBottomInstant` / `useChatScrollFollow`、Jump to latest、搜索定位与“用户离底”语义不变。接入 Overlay MUST NOT 替换或旁路这些 hook 返回的 ref。

#### Scenario: Stick to bottom while following

- **WHEN** 用户处于贴底跟随且助理流式输出增长内容
- **THEN** 对话 MUST 继续自动滚底
- **AND** Overlay thumb MUST 跟随更新

#### Scenario: User scrolls away

- **WHEN** 用户主动上滚离开底部
- **THEN** MUST NOT 强制拉回底部
- **AND** Jump to latest 等既有控件语义 MUST 保持

### Requirement: Target surfaces align scrollbars to their right edge

目标 surface 的 Overlay MUST 贴该 surface 内容区右边界。Home 对话贴边 MUST 通过 full-bleed 布局分层实现，使对话 viewport 右边界等于主卡片右边界；MUST NOT 使用负 margin、`calc(100% + …)` 或 portal 把 thumb 移出容器。macOS 与 Windows 目标环境 MUST 达到同一贴边视觉目标。

#### Scenario: Home conversation viewport is full-bleed to card edge

- **WHEN** 路由为 `/` 且主对话处于可滚动态
- **THEN** 对话 viewport 右边界 MUST 与主卡片右边界对齐
- **AND** Overlay thumb MUST 视觉贴该右边界

#### Scenario: Landing inset stays inside Home

- **WHEN** Home 处于落地态（无对话流全宽滚动需求）
- **THEN** 原视觉水平 inset MUST 仍由 Home 内部保留
- **AND** 其他非 `/` 路由的 MainLayout body padding MUST 不变

### Requirement: Non-target scroll surfaces remain unchanged

Settings、Agents、Skills、Models 及其他未列入首批接入清单的滚动区 MUST 保持现有全局 thin scrollbar 路径。本次变更 MUST NOT 删除全局 scrollbar CSS，也 MUST NOT 将非目标 surface 强制切换为 Overlay。产物 webview/iframe 内网页 scrollbar MUST 不在本 capability 控制范围内。

#### Scenario: Settings and other app lists keep global thin scrollbar

- **WHEN** 用户打开 Settings、Agents、Skills、Models 或其它未接入 surface
- **THEN** 这些区域 MUST 仍使用现有全局 thin scrollbar 行为
- **AND** 全局 scrollbar CSS MUST 仍然存在以服务这些区域

#### Scenario: Embed preview document scrollbar is out of scope

- **WHEN** 内嵌浏览器展示产物网页
- **THEN** Overlay 接入 MUST 仅作用于 Embed Chat 会话滚动区
- **AND** MUST NOT 修改 webview/iframe 文档内部 scrollbar

### Requirement: Light dark reduced-motion and forced-colors remain usable

Overlay 颜色 MUST 复用现有 thin-scrollbar light/dark 透明度语义。`prefers-reduced-motion: reduce` 下 MUST 禁用或显著缩短显隐过渡，但滚动与拖动 MUST 仍可用。`forced-colors: active` 下 MUST 隐藏自定义 Overlay，并恢复目标 viewport 的原生可见 scrollbar。

#### Scenario: Dark theme thumb contrast

- **WHEN** 应用处于 dark mode 且 Overlay active
- **THEN** thumb MUST 使用 dark 对应透明度/颜色 token，保持可辨识

#### Scenario: Reduced motion shortens fade

- **WHEN** 系统启用 reduced motion
- **THEN** Overlay 显隐 MUST 无长动画或接近瞬时
- **AND** 滚动与 thumb 拖动 MUST 仍可用

#### Scenario: Forced colors prefers native scrollbar

- **WHEN** `forced-colors: active`
- **THEN** 自定义 Overlay MUST 隐藏
- **AND** 目标 viewport MUST 恢复原生可见 scrollbar（若 WebKit 恢复写法在 Electron 不生效，记录实测结果，不得为此新增平台 JS 分支）
