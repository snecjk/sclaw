## Context

目标：侧边栏与主对话流使用统一的应用级 Overlay Scrollbar，视觉贴所属 surface 右边，滚动中显示、停止后立即消失（约 150ms 淡出），不占用内容宽度。

当前实现：

- 全局 thin scrollbar CSS + `useNativeScrollbarActivity`（120ms stop debounce）
- Sidebar：`useSidebarSectionScrollCollapse` 驱动 `scrollContainerRef`
- Home 对话：`HomeMainConversation` 使用 `useStickToBottomInstant` 的 `scrollRef` / `contentRef`；`/chat` 重定向到 `/`
- Embed Chat：独立会话与滚动，复用同一 stick-to-bottom 模式

产品与技术已确认结论（来源：`docs/侧边栏与对话流Overlay滚动条-Cursor开发文档.md` §2.4 / 方案 C）：

- 方案 C：共享 Overlay Scrollbar 原件
- stop detect：最后一次滚动后 120ms；到点后立刻移除 active，约 150ms 透明度淡出；无 2s dwell
- rail 10px / thumb 6px / min thumb 32px / 垂直 inset 4px
- hover 仅作用于 rail/thumb；v1 不做 track 空白区跳转；支持 thumb 拖动
- forced-colors：隐藏 overlay，恢复原生 scrollbar
- Overlay 为 pointer enhancement：`aria-hidden`，不做 `role="scrollbar"`
- 覆盖：Sidebar → Home（非 split → split）→ Embed；不改 Settings/Agents/Skills/Models 等

## Goals / Non-Goals

**Goals:**

- 共享原件 + 首批 surface 接入，满足九项验收契约
- 真实滚动仍由原 viewport 承担；overlay 只同步几何与活动态
- Home 通过 full-bleed body 分层，使对话 viewport 右边界等于主卡片右边界（无负 margin / calc / portal）
- light / dark / reduced-motion / forced-colors 可用；macOS / Windows 视觉一致目标由应用 overlay 承担

**Non-Goals:**

- 不改造非目标滚动区
- 不删除全局 scrollbar CSS（旧页面与未接入区仍依赖）
- 不接入 `src/pages/Chat/index.tsx` 为运行时入口
- 不控制 webview/iframe 内产物网页 scrollbar
- 不引入第三方 scrollbar 库、不新增依赖、不改工程配置
- v1 不做 thumb 点击跳转、不做横向 overlay、不做虚拟列表专用路径

## Decisions

### Decision 1：共享原件（方案 C）

- **Choice:** 单一 `OverlayScrollbar` + `useOverlayScrollbar` + `overlay-scrollbar-metrics`，Sidebar / Home / Embed 复用。
- **Rationale:** 三处需要同一套几何、120ms stop、hover/drag 与 forced-colors 行为；共享原件避免分叉计时与尺寸常量。
- **Alternative considered:** 方案 A（继续调原生/WebKit scrollbar）——无法保证 Windows classic 不占宽与跨平台贴边；方案 B（各 surface 各自实现 overlay）——重复逻辑与验收成本高。二者均已在开发文档否决，本 change 不重新引入。

### Decision 2：真实 scroll owner 不变

- **Choice:** Chat/Home/Embed 复用既有 `scrollRef` / `contentRef`；Sidebar 保留 `scrollContainerRef`，仅新增 `contentMeasureRef`。
- **Rationale:** sticky、自动收起、stick-to-bottom、用户离底均绑定现有 viewport；替换 owner 会破坏这些语义。
- **Alternative considered:** 新建外层滚动容器承载 overlay —— 会拆掉唯一 viewport，拒绝。

### Decision 3：活动语义对齐现有 Hook

- **Choice:** 120ms stop debounce；到点后立刻 `data-active=false`，CSS opacity 约 150ms 淡出；无额外 dwell。
- **Rationale:** 与现有 `useNativeScrollbarActivity` 用户预期一致，满足“停止后快速消失”。
- **Alternative considered:** 2s dwell 后再隐藏 —— 文档已否决（与产品“立刻淡出”冲突）。

### Decision 4：Home 贴边用布局分层，不用负 margin

- **Choice:** `MainLayout` 为 `/` 提供无水平 padding 的 Home body；落地态 inset 留在 Home 内部。
- **Rationale:** 对话 viewport 右边界等于主卡片右边界后，`right-0` overlay 自然贴边，无需负 margin / calc / portal。
- **Alternative considered:** 负 margin 或 portal 把 thumb 移出 padding 容器 —— 文档明确禁止（易漂移、难维护）。

### Decision 5：a11y 策略

- **Choice:** Overlay `aria-hidden`；键盘滚动依赖原生 viewport；forced-colors 下隐藏 overlay 并恢复原生可见 scrollbar。
- **Rationale:** Overlay 是 pointer 增强，不是第二套 a11y 滚动控件；forced-colors 优先系统原生可用性。
- **Alternative considered:** 为 overlay 声明 `role="scrollbar"` 并自管键盘 —— 与原生 viewport 双通道冲突，文档否决。

### Decision 6：水平对齐与 session row 解耦

- **Choice:** Overlay 贴边（任务 2）与 session row 水平对称（任务 3）拆开；任务 3 不得改动用户未提交的 active `font-medium` diff。
- **Rationale:** 降低并行冲突；用户已有 session row 字重改动需全程保护。
- **Alternative considered:** 在任务 2 一并改 row padding —— 扩大范围且易污染用户 diff，拒绝。

### Fixed parameters (doc §2.4)

```text
stopDetectMs = 120
fadeMs ≈ 150
railWidth = 10px
thumbWidth = 6px
minThumbHeight = 32px
verticalInset = 4px
```

## Risks / Trade-offs

- [Risk] Overlay 误绑替代 viewport，破坏 sticky / 自动收起 / stick-to-bottom → [Mitigation] 白名单强制复用既有 ref；relative wrapper 不滚动
- [Risk] Home inset 改动导致落地态漂移 → [Mitigation] 任务 4A 只分层布局、不接 overlay；先验收落地态
- [Risk] Split / Embed 行为回归 → [Mitigation] 分任务验证；split 若已覆盖则零/最小 diff
- [Risk] 清理阶段误删全局 scrollbar 或旧 Chat Hook → [Mitigation] 任务 7 默认保留；仅删确认零引用代码
- [Risk] 用户未提交 session row 改动被覆盖 → [Mitigation] 全程保护；任务 2/3 明确禁止无关 hunk
- [Risk] Electron 下 forced-colors WebKit 恢复写法不生效 → [Mitigation] 记录实测；不新增平台 JS 分支

## Migration Plan

按开发任务顺序落地：共享原件 → Sidebar → Home full-bleed → Home 非 split → Home split → Embed → 清理 → 验收。每步可独立验证与回滚。回滚优先撤销对应 surface 接入，保留共享原件直至确认无 consumer。

## Open Questions

无。参数与范围以开发文档已确认结论为准；任务 3 水平 inset 具体数值在实现前测量，不在 OpenSpec 阶段猜测。
