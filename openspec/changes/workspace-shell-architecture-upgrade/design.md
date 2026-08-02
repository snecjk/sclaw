## Context

- 仓库：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
- 总纲：`docs/可拖拽侧边栏与三栏工作区框架-Cursor-T2开发文档.md`
- 阶段文档：`docs/workspace-shell-upgrade/01`–`04`
- 风险：Tier 2（AppShell + 多栏工作区）
- Stage 0 日期：2026-07-31
- 当前分支：`canyang-ui-flow5` @ `2abcb29b`（与 `origin/2026.7.31-GA.1` 对齐）

### 设计稿溯源（MCP）

| 项 | 值 |
| --- | --- |
| 最新 goto | `https://mastergo.com/goto/UUOsojQL?page_id=39:06193&layer_id=48:10836&file=195806630222772` |
| file | `195806630222772` |
| page_id | `39:06193` |
| layer_id / Node ID | **`48:10836`**（根 Frame 名：**区域 4**，`6465×5077`） |
| Cursor 内置 MCP | **仍不可用**（`user-mastergo-magic-mcp` errored；`CallMcpTool` 报 server does not exist） |
| 实际读取方式 | `GET https://mastergo.com/mcp/dsl?fileId=…&layerId=…` + header `x-mg-useraccesstoken`（用户提供的新 `MG_MCP_TOKEN`；**token 不写入仓库**） |
| 读取时间 | 2026-07-31 |

#### 已确认子 Frame / 标注（同属 `48:10836`）

| Node ID | 名称 | 关键几何 / 文案 |
| --- | --- | --- |
| `48:10928` | 三栏展开 | 画板 `1440×900`；Sidebar `260`；Workspace 卡 `1172×884 @260,8`；Chat 列头 `576` / 预览列 `572@856`；预览体 `564` |
| `48:11093` | 三栏全屏 | Sidebar 样例 `280`；Workspace 卡 `1152×884 @280,8`；内容 `1128×832 @292,48`（Preview expanded 样例，非 min） |
| `48:14421` | 宽度调整拖动 | Sidebar `260`；与三栏展开同分栏；含拖拽热区示意 |
| `48:13442` | 最小尺寸 | Sidebar **`200`**；Workspace `1232×884`；Chat 列 `656`；Preview `564@856` |
| `48:13949` | 最大尺寸 | Sidebar **`400`**；Workspace `1032×884`；Chat 列 `526`；Preview `~494–505@926` |
| `48:14416` | 文案 | `默认尺寸 = 260px` |
| `48:13918` | 文案 | `最小尺寸 = 200px` |
| `48:13925` | 文案 | `最大尺寸 = 400px` |
| `48:13934` 等 | 交互说明 | 260 吸附；记忆 last width；200 吸附 + 再左拖约 `24px` 隐藏；400 封顶 |

**Sidebar 200 / 260 / 400 已由该节点明确批准。**

#### 四个 Workspace 最低宽度（产品书面批准 · 2026-07-31）

| 参数 | 批准值 | 来源 |
| --- | --- | --- |
| `closedWorkspaceMin` | **560px** | 用户书面批准（非画板样例反推） |
| `splitChatMin` | **480px** | 用户书面批准 |
| `splitPreviewMin` | **560px** | 用户书面批准 |
| `expandedPreviewMin` | **640px** | 用户书面批准 |

上表为 Stage 0 阻塞解除依据。Node `48:10836` 内 1440 画板列宽仍只作几何溯源，不得覆盖本批准表。

**最低宽度阻塞已解除。** 进入阶段 1 仍需用户确认 Stage 0 OpenSpec 验收（tasks 0.8）。

### 真实运行入口（2026-07-31 代码审计）

| 入口 | 事实 |
| --- | --- |
| `/` | `Home` → `HomeMainConversation`（主对话运行时） |
| `/chat` | `Navigate to="/" replace`；`src/pages/Chat/index.tsx` **不是**默认运行入口 |
| 省区壳 | `MainLayout` + `getSidebarLayoutVariant() === 'provincial'` |
| full legacy | `MainLayout` TitleBar + flex Sidebar（collapsed 宽 72） |
| Settings | 省区走无 Sidebar 特殊分支；`App.tsx` 仍可能按 hasSidebar 算 Toast 宽 |
| Overlay | 已接入 Sidebar mid-scroll、`HomeMainConversation`、`SclawBrowserEmbedChat` |

### 现场代码事实（不得用旧文档覆盖）

1. **AppShell**：省区 `stoAppShellBodyProvincialClass` 为 flex；`stoMainCardWrapClass(expanded)=pt-2 pb-2`；collapsed 靠 body `p-2` 拼四边 8px。
2. **Sidebar**：CSS `--sto-sidebar-w-expanded:260px` / collapsed `72px`；省区 `isProvincialFullyHidden` 时宽度 0；无 `sidebarPreferredWidth`。
3. **Context 收起**：`Sidebar.tsx` Workflow editor `useEffect` 直接 `setSidebarCollapsed`，会覆盖用户偏好。
4. **Toast**：`App.tsx` `sidebarWidth = hasSidebar ? (collapsed ? 72 : 260) : 0` + provincial gutter 8。
5. **Split**：`[--sto-split-preview-inset-x:10px]`；Chat `pr` / Preview `pl`；Handle `row-span-2` + `translate-x-[var(--sto-split-preview-inset-x)]`。
6. **Preview**：boolean `showPreviewPanel` + `isSplitLayout`；`FilePreviewViewer` / `ChatPreviewPanel` 使用 `requestFullscreen` / `fullscreenchange`。
7. **Header**：`ContentHeaderSlot` = `chatActions` + `actions` + `isSplitLayout`；无 `previewActions` / `layoutMode`；代码中无 `panelActions` 字段（仅旧 OpenSpec 文档）。
8. **OverlayScrollbar**：实现完整；`openspec/.../overlay-scrollbar-surfaces/tasks.md` 勾选滞后于代码。

## Goals / Non-Goals

**Goals**

- 单一 OpenSpec 承载阶段 1–4 串行实施及阶段 5 人工验收收口。
- 四个 capability 唯一归属，无交叉重复所有权。
- 明确删除冲突方案（Fullscreen / 10px seam / row-span-2 translate / 72·260 Toast / 三套 Header actions）。
- 登记阻塞参数与 MCP 状态。

**Non-Goals（Stage 0）**

- 修改 `src/`、`electron/`、tests、样式。
- 实现拖拽、PreviewMode、主题调色。
- 猜测四个最低宽度数值。

## Capability 归属

| Capability | 所有权 | 阶段 |
| --- | --- | --- |
| `app-shell-foundation` | Sidebar/Workspace 两列 Grid、Frame、边界 overlay、Provider、collapse reasons 分离、Toast/Header 消费 effective 宽 | 1（基座）；2 扩展 max；5 几何收口 |
| `resizable-sidebar-shell` | 200–400、吸附、viewport 自动收起、preferred 持久化 | 2 |
| `workspace-layout-modes` | PreviewMode、零 seam、Handle、稳定 Header 槽位、44px Header / 28px controls、Conversation 保活 | 3；5 人工验收收口 |
| `shell-surface-hierarchy` | L0–L3 语义、light/dark 同结构、集成验收矩阵 | 1 建所有权；4 调色与总验收 |

OverlayScrollbar 归属既有 `overlay-scrollbar-surfaces`；本 Change **依赖复用**，不新增第五 capability。

## Decisions

### 1. 单一 Change + 五阶段串行
- **Decision**：只建 `workspace-shell-architecture-upgrade`；阶段 1–4 完成后在同一 Change 增加阶段 5 收口，禁止并行修改这些结构源码。
- **Rationale**：总纲要求统一设计、串行验收；阶段 5 修正同一组 capability 的人工验收缺陷，另建并行 Change 会导致 Frame / PreviewMode / Surface 所有权再次冲突。
- **Alternative**：四个独立 Change → 否决（契约重复、冲突难收敛）。

### 2. Preview expanded = Workspace 内布局模式
- **Decision**：`PreviewMode = 'closed' \| 'split' \| 'expanded'`；expanded 占满 L1 Workspace，Conversation 隐藏但不卸载；禁止 DOM Fullscreen / `position:fixed` 假装展开。
- **Horizontal geometry**：设计节点 `48:11093` 的 Workspace `1152px`、Preview Surface `1128px`，差值由左右各 `12px` 的 Body-owned inset 构成。Sidebar 可见时，Expanded Header 的 Preview icon/tab 组 SHALL 复用该 Token，使其外框起点与下方 Surface 左边界共线；隐藏的 Conversation Header 槽保持挂载但不得占宽。Sidebar 收起时 Header 继续使用 macOS safe inset。该 inset 不得复用 Split end-only inset，也不得并入 8px L0 Workspace Frame。
- **Rationale**：保留草稿、scrollTop、消息与 Overlay host；避免系统 Fullscreen 与壳层 Frame 冲突。
- **Alternative**：保留 `requestFullscreen` → **删除**（与总纲冲突）。

### 3. 零结构空缝 + Body-only Handle
- **Decision**：删除 `--sto-split-preview-inset-x:10px` 双边结构空缝；逻辑边界 0px；Handle 8px overlay 仅 Preview 侧、仅 Body Row；禁止 `row-span-2` 与 `translate-x(10px)`。
- **Rationale**：Chat OverlayScrollbar rail 必须与 Preview 左边框重合。
- **Alternative**：保留 10px 视觉 inset 作「卡片间距」→ 否决为结构空缝；卡片内部 padding 可另用 Token。

### 4. Header 最终命名
- **Decision**：`chatActions + previewActions + layoutMode`；迁移后删除 `actions` / 文档中的 `panelActions`；不得三套并存。
- **Rationale**：消除 Chat/Preview 操作列语义漂移。
- **Alternative**：继续用 `actions` 表示预览列 → 否决（与 `chatActions` 命名不对称）。

### 5. Toast 读 AppShell effective width
- **Decision**：`AppShellLayoutProvider` 位于 Routes 与 Toaster 共同父级；Toast 使用 `effectiveSidebarWidth`（Settings/no-sidebar → 0）；删除 `collapsed ? 72 : 260`。
- **Rationale**：省区 collapsed 为 0 而非 72；Settings 无 Sidebar。
- **Alternative**：继续硬编码 → **删除**。

### 6. Collapse reasons 与持久化键
- **Decision**：持久化仅 `sidebarCollapsed`（语义=user）+ `sidebarPreferredWidth`；非持久化 `sidebarViewportCollapsed` / `sidebarContextCollapsed`；禁止新增 `sidebarUserCollapsed`。
- **Rationale**：兼容旧数据；Workflow 只改 context reason。
- **Alternative**：新键 `sidebarUserCollapsed` → 否决（双源真相）。

### 7. OverlayScrollbar 只复用
- **Decision**：阶段 3 只调整 host/rail 几何对齐；不复制 metrics/hook/组件。
- **Rationale**：已落地契约（120ms stop、rail/thumb、forced-colors）。
- **Alternative**：为三栏重写滚动 → 否决。

### 8. 四个最低宽度 — 已批准
- **Decision**：采用用户 2026-07-31 书面批准值；阶段 2 `effectiveMax` / `workspaceRequiredWidth` 必须引用下表，禁止改用画板样例反推或窗口 960 反推。

| 参数 | 含义 | 数据来源 | 批准值 |
| --- | --- | --- | --- |
| `closedWorkspaceMin` | Preview closed 时 L1 Workspace 最小内容宽 | 用户书面批准 2026-07-31 | **560px** |
| `splitChatMin` | split 时 Conversation 列最小宽 | 用户书面批准 2026-07-31 | **480px** |
| `splitPreviewMin` | split 时 Preview 列最小宽 | 用户书面批准 2026-07-31 | **560px** |
| `expandedPreviewMin` | expanded 时 Preview 占满 Workspace 的最小可用宽 | 用户书面批准 2026-07-31 | **640px** |

派生关系（阶段 2 使用）：

```ts
workspaceRequiredWidth =
  previewMode === 'closed'   ? closedWorkspaceMin :
  previewMode === 'split'    ? splitChatMin + splitPreviewMin :
  /* expanded */               expandedPreviewMin;

effectiveMax = Math.min(
  400,
  viewportWidth - shellFrameWidth - workspaceRequiredWidth,
);
```

`split` 模式下 `workspaceRequiredWidth` 取 `splitChatMin + splitPreviewMin`（480+560=**1040px**），除非后续产品另行批准「只按单列」公式。

- **Alternative**：用 Node `48:10836` 1440 样例列宽或窗口最小 960 反推 → **明确禁止**。

### 9. Stage 5 几何所有权收口（人工验收修正）

- **Decision**：省区 AppShell 从 `Sidebar | 8px Gap | Workspace` 三列改为 `Sidebar | Workspace` 两列；8px Sidebar resize hit area 绝对覆盖在 Workspace 起始侧，不占布局宽度，提示线固定在真实边界。
- **Rationale**：运行时测量证明 Scrollbar 已贴 Sidebar 右边界，人工截图中的空带来自其后的 8px Grid Track；浅色下该 Track 与 Sidebar 同色，导致用户把它感知为 Sidebar 的一部分并产生约 4px 光学偏移。
- **Alternative**：保留 8px Track 并移动 Scrollbar/内容补偿 → 否决，会继续制造结构空缝并在 dark 模式暴露第三层色带。

  同步几何消费者：provincial `SHELL_FRAME_HORIZONTAL_PX` 从旧的“Gap 8 + right Frame 8”校准为仅 right Frame `8px`；`computeToastLayoutOffsetPx` 删除旧 Gap，只返回 effective Sidebar width（no-sidebar=0；full legacy 保持真实 rail）。批准的 Workspace 最低宽度值不变。

- **Decision**：将 Header chrome safe inset、Workbench Body inset 和 Workspace Frame 拆成独立 Token；macOS collapsed 的 80px safe inset 只允许 Header 消费，`main`/Preview Body 不得消费。
- **Rationale**：当前 `stoSplitShellInsetsClass` 挂 `main` 使 Preview Expanded Body 继承 5rem，直接生成错误大空白。
- **Alternative**：Preview collapsed 模式加负 margin 抵消 → 否决为状态补丁。

- **Decision**：ContentHeader 保留现有注册协议，但收敛为单一 DOM（chat zone + preview zone + stable workspace-actions）；layoutMode 只改变 Grid Area/visibility。最新产品验收将一级 Header 收紧为 `44px`，主要操作框、Session/Artifact pill 与 Search Surface 统一为 `28px`；Search 仍作为向左 overlay 的临时工具，不进入主 Flex 宽度，SVG glyph 保持 `16px`。
- **Rationale**：三套 return 会改变同一 preview action 的父容器和水平锚点；Search 普通流 264px 宽度会推动 actions。
- **Alternative**：为每个模式记录独立 `right`/`translate` → 否决，状态组合不可维护。

- **Decision**：Sidebar 展开时 Workspace start Frame 为 `0px`，Sidebar 完全收起时为 `8px`；Split Preview 的 L2 描边 Surface 额外拥有 `12px` end inset，因此窗口到描边总距为 `8+12=20px`。该 inset 只属于 Split Body，不挂 `main`，不改变 Preview 左侧零 seam，也不下放给 Preview Expanded。
- **Rationale**：删除旧 `main` 水平 inset 修复了 collapsed Preview 的 5rem 空白，但同时误删了 Split Preview Surface 的设计留白。Workspace 外框、Header 操作锚点和 L2 Surface inset 必须分别建模。
- **Alternative**：给 Preview 卡片加 `mr-3` / `translate-x(-12px)` / `width:calc(...)` → 否决，会令 Grid 百分比、Resize Handle 与视觉边界分叉。

- **Decision**：Preview Expanded 隐藏并禁用 Conversation title/search/refresh/thinking，但保持其 DOM/状态；Workspace expand/restore 提升到 ContentHeader，并固定在 Preview panel toggle 左侧。Header chat/preview slots 不得出现可见原生横向滚动条。
- **Rationale**：Conversation 已 hidden/inert 时其操作不应进入 Preview 区；当前 `overflow-x-auto` 会在 classic scrollbar 环境生成约 12–15px 透明条；布局动作和文件动作分处两级 Header 导致顺序无法稳定。
- **Alternative**：Expanded 下把 chatActions 搬到 preview zone、在三枚按钮上逐个 `hidden`、或在 Body action row 绝对定位最大化按钮 → 否决，均继续混淆槽位所有权。

- **Decision**：macOS native traffic lights 与 Sidebar chrome toggle 使用独立光学基线：traffic lights `{x:16,y:20}`；Sidebar toggle 使用 `16px` top inset + `28px` 点击框；ContentHeader DOM 使用独立的 44px `items-center` 契约。
- **Rationale**：Electron native 坐标、Sidebar row 坐标和 Workspace Header 坐标原点不同，旧“全部 centerY=34”测试只能证明数学外框，不能覆盖最新运行时光学验收。
- **Alternative**：逐 SVG `translate-y` 或继续强制一个中心线 → 否决。

- **Decision**：DOM center、SVG optical center、macOS native center 分层验收；不使用逐按钮 `translate-y`。Header `44px`、主要控件与 Search Surface `28px` 为最新批准值；此前 `52/32` 仅保留为历史测量依据。
- **Rationale**：44px Header 内 28px 控件具有上下各 8px 的对称空间；SVG 可见画布和 native chrome 仍使用独立光学验收。
- **Alternative**：仅用 class 字符串测试 `items-center` → 否决，不能证明最终像素关系。

## 与活动 OpenSpec 的冲突处理

| Change | 冲突 | Stage 0 处理 |
| --- | --- | --- |
| `chat-file-preview-enhancement` | DOM Fullscreen；10px seam；`row-span-2`；`panelActions` | 修订 proposal/design/spec/tasks：删除 Fullscreen 方向；布局/seam/Handle/Header 移交本 Change；iframe key 等非冲突任务保留 |
| `unify-toast-and-chat-error-feedback` | Toast 72/260 | 修订 design/proposal/tasks：定位改为依赖 `app-shell-foundation` effective width；视觉任务可维持已完成 |
| `overlay-scrollbar-surfaces` | tasks 未勾选但代码已实现 | 仅同步 `tasks.md` 勾选；不改 spec/实现 |

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| [Risk] 最低宽度被画板样例覆盖 | 批准表锁定 560/480/560/640；阶段 2 只读 design §8 |
| [Risk] 未完成 Stage 0 文档验收就改源码 | tasks 0.8 未勾选前禁止阶段 1 Implement |
| [Risk] MCP 长期不可用 | 允许产品书面批准表；阶段 2/3 仍强依赖节点时停止 |
| [Risk] 旧 Fullscreen 代码与 OpenSpec 漂移 | 阶段 3 删除 API；本 Stage 0 先改文档方向 |
| [Risk] Overlay tasks 勾选误导后续 agent 重写 | 校准 tasks 为已完成；design 写明只复用 |
| [Risk] Settings Toast 偏移 | 阶段 1 Provider `hasSidebar=false` / width=0 |
| [Risk] Workflow 覆盖用户偏好 | context reason 非持久化；恢复不写 user 键 |

## Migration Plan（实施阶段，非 Stage 0）

1. 阶段 1：Grid + Provider + Toast/Header 接线；Sidebar 仍固定 260（历史实施基线）。
2. 阶段 2：拖拽与 preferred；依赖已批准最低宽度。
3. 阶段 3：PreviewMode + 零 seam + Header 重命名 + 去 Fullscreen。
4. 阶段 4：Surface 色阶与总验收。
5. 阶段 5：撤销实体 Sidebar Gap；Header/Body inset 解耦；稳定 Header slots；44px Header / 28px Search；真实几何回归。

每阶段：定向 vitest / eslint 白名单 / typecheck / `git diff --check` → 用户手动验收 → 停止。

## Open Questions（非阻塞 / 阶段再锁）

1. ~~四个最低宽度~~ → **已批准**：560 / 480 / 560 / 640（见 §8）。
2. Cursor 内置 MasterGo MCP 仍 errored；阶段 2/3 可用已验证 HTTP DSL + Node `48:10836`。
3. 阶段 3 MCP 子 Node 的 **52px** 作为历史溯源保留；产品 2026-08-02 最新人工验收批准一级 Header **44px**、主要控件 **28px**，以最新批准值为实现契约。
4. Stage 3 人工验收失败项（统一顶栏垂直契约）补测与校准见 §9。

## 9. Header vertical metrics（Stage 3 复测 · 2026-08-01）

### 9.1 MCP 读取范围

| 项 | 值 |
| --- | --- |
| 根 Frame（区域 4） | `48:10836`（仅作索引，**不足**） |
| 三栏 Frame | **`48:10928` 三栏展开** `1440×900` |
| 读取方式 | `GET https://mastergo.com/mcp/dsl` + `x-mg-useraccesstoken`（Cursor MCP 仍 errored） |
| 原生 macOS traffic lights | **设计稿无** → 用运行时几何 + 直径公式校准 |

### 9.2 Header 子 Node 测量表（相对父组 local；height 权威）

| Node ID | Name | top (ry) | height | local centerY | 备注 |
| --- | --- | --- | --- | --- | --- |
| `48:11086` | 组 7046（Chat 顶栏） | 0 | **52** | 26 | 一级顶栏左列 |
| `48:11087` | Container（7046 内） | 8 | 44 | 30 | 设计稿内 8px 顶垫；**实现不重建 DOM**，运行时用 `items-center` |
| `48:11089` | 标题「2026年05月10日 · …」 | 20（相对 7046） | 20 | **30** | 标题 |
| `48:11022` | 组 7047（Preview 顶栏） | 0 | **52** | 26 | 一级顶栏右列 |
| `48:11023` | Container（7047 内） | 8 | 44 | 30 | 同上 |
| `48:11038` | Tab | 15 | 30 | **30** | Layout/菜单类 |
| `48:11046` 等 | Tablist - 预览视图 | 15 | 30 | **30** | Preview tabs |
| `48:11025` | SVG（工具图标） | 22 | 16 | **30** | 工具图标中心 |
| `48:11059` | Header（Preview **二级**） | 0（相对预览容器） | 52 | 26 | 产物内操作行，非一级 ContentHeader |

Workspace 卡 `矩形 2482`：`1172×884 @ (260, **8**)` → 与运行时 Workspace top frame `8px` 一致。

### 9.3 Stage 3 历史运行时基线（已由 9.6 supersede）

| Quantity | Value |
| --- | --- |
| Workspace top | 0 |
| Workspace top frame | 8px |
| ContentHeader top | 8px |
| ContentHeader height | 52px |
| ContentHeader centerY | **34px**（= 8 + 26） |
| 标题 / 搜索 / 刷新 / Brain / Tab / 布局按钮 centerY | **均为 34px** |

→ Header 内部 `items-center` **正确**；禁止重写 Header DOM。

### 9.4 Header → 正文公式（Stage 5 最新批准）

```text
Conversation:
CONVERSATION_HEADER_TO_SURFACE_GAP       = 0px   // Header bottom → Body Surface
WORKBENCH_BODY_TO_CONTENT_INSET_Y        = 8px   // Body Surface → 第一行正文
TOTAL                                    = 8px

Split:
SPLIT_HEADER_TO_SURFACE_GAP              = 0px   // Header bottom → Chat / Preview Surface
WORKBENCH_BODY_TO_CONTENT_INSET_Y        = 8px   // Chat Surface → 第一行正文
TOTAL                                    = 8px

Preview Expanded:
PREVIEW_EXPANDED_HEADER_TO_SURFACE_GAP   = 0px   // Header bottom → bordered Preview Surface

Split / Preview Expanded bottom:
WORKBENCH_SURFACE_BOTTOM_INSET           = 8px   // Surface → Workspace Body bottom
WORKSPACE_FRAME_BOTTOM                   = 8px   // Workspace Body → Window bottom
WINDOW_TO_SURFACE_BOTTOM_TOTAL           = 16px
```

验收失败前：`Split Body pt=8` 形成持久空带，并与 Chat Scroll 内距叠成初始 `8+8=16px`；Split Body 顶距改由独立 `0px` Token 所有，禁止再继承 Conversation gap。
用户 2026-08-02 最终确认 Conversation、Split 与 Preview Expanded 的 Surface 均紧接一级 Header；Conversation/Split Chat Surface 内部仍保留 8px 正文内距。Surface 本身、46px action row 和 viewer overflow owner 保留。
同日人工验收确认 Split 底部留白为正确基准；Preview Expanded 必须复用同一 Body-owned bottom inset，不得在模式切换后贴住 Workspace 底边。

### 9.5 macOS traffic lights 校准

设计稿无原生控件。对现网 `{ x:16, y:18 }`：

| 项 | 值 |
| --- | --- |
| macOS traffic light 直径 | 12px（points） |
| Electron `trafficLightPosition.y` 语义 | close 按钮 **顶边** |
| 现网 y=18 → 圆心 | 18+6 = **24** |
| Header centerY | **34** |
| 现网 Δ | **10px**（>2px，失败） |
| 校准 y | 34 − 6 = **28** → 圆心 34，Δ=0 |
| x | 保持 **16**（水平未报失败） |

本节记录 Stage 3 的数学中心校准过程；Stage 5 已由独立光学基线 `{x:16,y:20}` supersede，Header 缩至 44px 时不得重新用 Header centerY 反推 native 坐标。

### 9.6 最新紧凑 Header 契约（产品批准 · 2026-08-02）

| Quantity | Value |
| --- | --- |
| Workspace top frame | 8px |
| ContentHeader height | **44px** |
| ContentHeader centerY | **30px**（= 8 + 22） |
| Primary Header control / Session / Artifact / Search | **28px** |
| Header SVG glyph | **16px 保持** |
| Conversation / Split / Expanded Header → Surface | **0px** |
| Conversation / Split Chat Surface → first content | **8px** |

实现必须通过共享 Header/Control Token 收口，不得修改 Preview 46px 二级 action row、macOS traffic lights 或用逐控件偏移补偿。
