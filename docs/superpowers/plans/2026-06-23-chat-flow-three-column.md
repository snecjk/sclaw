# 对话流三栏框架 + 预览区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复对话流三栏布局的三个交互 Bug（输入区宽度、默认对半分+记忆比例、预览区遮挡），并按 MasterGo「stoclaw框架」设计稿完成对话区/预览区卡片化与预览头部双行改造。

**Architecture:** 以 `stoChatShellPageColumnClass` 为对话列唯一限宽源；预览占比从 `settings.previewSplitPercent` 持久化读写；面板样式抽到 `surfaces.ts` 新 token；预览头部拆为 Tab 行 + 操作行，关闭单个 tab 用 hook 内本地 `dismissedFilePaths` 过滤。三栏容器逻辑仅改 `Chat/index.tsx`（文档 §2 范围），`HomeMainConversation` / `TaskSubitemChatSurface` 做回归验证。

**Tech Stack:** React 19 + TypeScript + Tailwind + Zustand persist + Framer Motion（预览区进出场保留）

**依据文档:** `docs/对话流改造-任务4-三栏框架与预览区.md`  
**设计稿:** MasterGo `stoclaw框架` — [链接](https://mastergo.com/goto/TVY09tNA?page_id=M&layer_id=8:25709&file=196906035108330)  
**分支:** `feat/chat-flow-three-column`（动手前先 commit）

---

## 阶段一：现状分析 + 方案（确认后再写码）

### 1. 宽度层级问题（Bug 4.1）— 已核实根因

当前对话列里**三套宽度各管各的**：

```
stoChatShellPageColumnClass (max-w-862 + mx-auto)
├── 消息区 scrollRef          → 无 px，满列宽
├── ParameterFormDock 挂载    → px-6 + max-w-5xl (1024px)  ← 比 862 更宽
└── ChatInput 外层            → 再套 stoChatShellPageClass + px-6  ← 双重限宽
```

代码位置：

- 对话列：`src/pages/Chat/index.tsx` L451 `stoChatShellPageColumnClass`
- 参数浮层：`index.tsx` L616–620 `px-6` + `max-w-5xl`
- 输入框：`src/pages/Chat/ChatInput.tsx` L707 `stoChatShellPageClass` + `px-6`

**目标宽度层级（方案 A — 推荐，待 🟥#1 确认）：**

```
stoChatShellPageColumnClass + px-6          ← 唯一限宽 + 统一水平内距
├── Toolbar / Messages / Error / Queue      → w-full（不再各自限宽）
├── ParameterFormDock                       → w-full（去掉 max-w-5xl）
└── ChatInput (page variant)                → w-full px-0（去掉重复 stoChatShellPageClass）
```

三栏模式下对话列随 `stoSplitChatPaneClass` 收缩，**整列**（消息 + 浮层 + 输入）一起缩放，左右边缘始终对齐。

`embedded` / `home` 变体不动（仍用 `stoChatShellHomeClass`）。

---

### 2. 默认比例 + 拖拽 + 记忆（Bug 4.2）— 已核实

| 项 | 现状 | 目标 |
|---|---|---|
| 默认值 | `useState(70)` — `index.tsx` L75 | **50**（对半分） |
| CSS 变量 | `--sto-split-default-preview: 70%` — `globals.css` L80 | **50%** |
| 夹取函数 | `clampPreviewPanelPercent` 30–70 — `surfaces.ts` L160–164 | **50–70**（🟥#2 待确认下限） |
| 拖拽 handler | `Math.max(w*0.3, Math.min(w*0.7, …))` — `index.tsx` L373 | 同步改为 **50–70** |
| 记忆 | 组件内 state，卸载重置 | `settings.previewSplitPercent` persist |

**持久化落点：**

```ts
// src/stores/settings.ts
previewSplitPercent: number;        // default 50
setPreviewSplitPercent: (n: number) => void;
```

```ts
// src/pages/Chat/index.tsx
const previewSplitPercent = useSettingsStore((s) => s.previewSplitPercent);
const setPreviewSplitPercent = useSettingsStore((s) => s.setPreviewSplitPercent);
// 拖拽 cleanup 时：setPreviewSplitPercent(clampPreviewPanelPercent(...))
// 初始宽度：style={{ width: `${previewSplitPercent}%` }}
```

**设计稿佐证（MasterGo）：**

- 三栏态 `矩形 2498`（对话卡片）宽 **576px**，主内容区 `矩形 2482` 宽 **1152px** → **50:50**
- 状态 4 底部 `30%` / `70%` 文字为**设计标注**（section 8:30499 / 8:30489），非可见 UI 控件 → 🟥#4 建议不做成控件

---

### 3. 预览区遮挡（Bug 4.3）— 根因判断

**根因 1（高置信 — Windows）：**  
`AppShellChromeOverlay` → `WindowsControlsOverlay` 为 `absolute right-0 top-0 z-40`（`app-shell-chrome-overlay.tsx` L74），压在预览头部右上角操作按钮上。

**根因 2（macOS / 全平台）：**  
`Chat/index.tsx` L446 `-m-6` 把内容上移；省区壳无整行顶栏，预览头部贴窗口顶，与 `--sto-chrome-h`（44px）区域重叠。

**最小改法（不改全局 chrome 浮层 — 🟥#3 默认方案）：**

1. `ChatPreviewPanel` 头部区域加 `pt-[var(--sto-chrome-h)]`（或外层 preview pane 加 top padding）
2. 操作按钮行右侧：`win32` 下额外 `pr-[120px]`（约 3×40px 窗口按钮宽度），macOS 折叠侧栏展开钮场景 `pr-20` 按需
3. **不**降低 `WindowsControlsOverlay` z-index

---

### 4. 样式：设计稿 vs 现状（MasterGo 已取值）

| 元素 | 设计稿（MCP） | 现状 | 差距 |
|---|---|---|---|
| 对话/预览卡片背景 | `#F7F8FA`（`paint_4:0485`） | 预览 `border-l` 贴边灰底 | 需卡片化 |
| 卡片圆角 | **18px** | 无 / 仅预览内容区 | 需 `rounded-[18px]` |
| 卡片阴影 | `0 0 16px rgba(0,0,0,0.01)` | 无 | = 项目 `shadow-glow` |
| 预览描边 | **1px #E5E6EB** | `border-l border-border/40` | 改全框描边 |
| 两栏间距 | 设计稿两卡片**贴边**（576+576=1152） | 5px 拖拽条占位 | 拖拽条改窄/透明，卡片间 **8px gap** 由外层 flex `gap-2` 承担（🟥 需设计确认是否要有缝） |
| 预览 Tab 行（上行） | 高 44+8px；选中 tab 底 `#E5E6EB`；未选 `#F5F6F7`；圆角 10px；× 12px `#86909C` | 单行「产物/工作流」+ 下拉 | 需双行重构 §4.4 |
| 预览操作行（下行） | 标题 14px Medium `#1D2129`；元信息 12px `#A4AAB3`；按钮 30×30 圆角 7px 图标 `#9CA3AF` | 操作挤在 Tab 行右侧 | 需拆行 |
| 拖拽条 | MCP 未单独给 token | 5px `bg-border/50` | 阶段二保留结构，颜色 hover 对齐 primary |

**新增 surfaces token（建议）：**

```ts
// src/lib/surfaces.ts
export const stoSplitChatCardClass = cn(
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px]',
  'bg-[var(--sto-main-card-bg)] shadow-glow',
);
export const stoSplitPreviewCardClass = cn(
  'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[18px]',
  'border border-border bg-[var(--sto-main-card-bg)] shadow-glow',
);
export const stoPreviewTabRowClass = '...';   // 从 MCP 组 7047 提取
export const stoPreviewActionRowClass = '...'; // 从 MCP Header 提取
```

---

### 5. 预览头部双行（§4.4）方案

**上行 — 产物 Tab 行：**

- `map(previewableFiles)` → pill tab + `×` 关闭
- 左端 `☰`（`Menu` icon）→ 溢出 Dropdown（产物 >3 时）
- 右端收起图标（`PanelRightClose`）→ 调 `closePreviewPanel`
- 隐藏原 L213–270 file switcher（条件渲染 + 注释，不删）
- 工作流：当 `showWorkflowTab` 时，工作流作为 tab 行中的一个 tab（🟥#8 推荐方案）

**下行 — 操作行：**

- 左：当前产物 `fileName` + 元信息（🟥#9 字段待确认，缺则暂不展示）
- 右：全屏 / 刷新 / 下载 / 外链（现有 handler 搬迁）
- 工作流 tab 激活时：额外「编辑工作流」文字按钮

**关闭单个 tab：**

```ts
// use-chat-preview-panel.ts
const [dismissedFilePaths, setDismissedFilePaths] = useState<Set<string>>(new Set());
const visibleFiles = previewFiles.filter(f => !dismissedFilePaths.has(f.filePath!));
// 关最后一个 → closePreviewPanel()
```

---

### 6. 🟥 待确认项（实施前请用户拍板）

| # | 问题 | 推荐默认 |
|---|---|---|
| 1 | 水平内距：整列统一 `px-6` 还是输入去 px 跟消息齐边？ | **整列 px-6** |
| 2 | 拖拽下限：预览区能否窄于 50%？ | **不能，范围 50%–70%**（默认=最窄） |
| 3 | 是否允许改 `app-shell-chrome-overlay.tsx`？ | **否**，只改预览头部留位 |
| 4 | 30%/70% 标尺做成 UI？ | **否**，仅设计标注 |
| 5 | 记忆比例存 settings persist？ | **是** |
| 6 | tab `×` 语义：本地隐藏 vs 其他？ | **本地隐藏**；最后一个 tab 关闭 → 收起预览 |
| 7 | `☰` 行为 | **溢出菜单**列出全部产物 |
| 8 | 工作流与产物 tab 关系 | **工作流作为 tab 行中的一个 tab** |
| 9 | 下行「数据日期」数据来源 | 需后端/产品确认；无字段则 **v1 不展示** |

---

### 7. 范围外但需回归的重复实现

以下文件**不在 §2 改动列表**，但复制了三栏逻辑，Task 4 完成后需手动回归：

| 文件 | 重复逻辑 | 本任务处理 |
|---|---|---|
| `src/pages/Home/HomeMainConversation.tsx` | `previewPanelPercent=70`、split/resizer | 仅回归 ChatInput 宽度 |
| `src/pages/TaskDetail/TaskSubitemChatSurface.tsx` | 同上 + ParameterFormDock `max-w-5xl` | 仅回归；split 比例留后续任务 |

若用户要求「整个对话流」一并修复，可在 🟥 确认后把这两文件加入 Task 5 跟进 PR。

---

## 阶段二：Implementation Tasks

> 前置：用户确认 §阶段一 🟥 项 + 方案 A 宽度层级。

---

### Task 0: 分支与 baseline commit

**Files:** git only

- [ ] **Step 1:** 确认当前改动（`ChatInput.tsx` pb-6→pb-0 等）是否需要保留

```bash
git status
git diff
```

- [ ] **Step 2:** 创建分支并提交 baseline

```bash
git checkout -b feat/chat-flow-three-column
git add -A
git commit -m "chore: baseline before chat three-column layout refactor"
```

---

### Task 1: 持久化 previewSplitPercent

**Files:**
- Modify: `src/stores/settings.ts`
- Modify: `src/styles/globals.css`（`--sto-split-default-preview`）

- [ ] **Step 1:** 在 `SettingsState` 增加字段

```ts
previewSplitPercent: number;
setPreviewSplitPercent: (percent: number) => void;
```

- [ ] **Step 2:** `defaultSettings` 增加 `previewSplitPercent: 50`

- [ ] **Step 3:** 实现 setter + 并入 `persist` partialize（若 partialize 白名单存在则加入）

- [ ] **Step 4:** `globals.css` 改 `--sto-split-default-preview: 50%`

- [ ] **Step 5:** Commit

```bash
git add src/stores/settings.ts src/styles/globals.css
git commit -m "feat(settings): persist preview split ratio default 50%"
```

---

### Task 2: 统一 clamp + surfaces token

**Files:**
- Modify: `src/lib/surfaces.ts`

- [ ] **Step 1:** 更新 `clampPreviewPanelPercent` — 默认 50，夹取 50–70

```ts
export function clampPreviewPanelPercent(containerWidth: number, previewPx: number): number {
  if (containerWidth <= 0) return 50;
  const pct = (previewPx / containerWidth) * 100;
  return Math.max(50, Math.min(70, pct));
}
```

- [ ] **Step 2:** 新增卡片 class（见阶段一 §4）

- [ ] **Step 3:** 新增预览头部 tab/action row class（精确值来自 MCP 组 7047 / Header）

- [ ] **Step 4:** Commit

```bash
git add src/lib/surfaces.ts
git commit -m "feat(surfaces): split card tokens and 50-70 preview clamp"
```

---

### Task 3: 对话列宽度统一（Bug 4.1）

**Files:**
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/ChatInput.tsx`

- [ ] **Step 1:** `index.tsx` — 对话列根 div 加统一水平内距

```tsx
<div className={cn(stoChatShellPageColumnClass, 'px-6')}>
```

- [ ] **Step 2:** `index.tsx` L616–620 — 去掉 `max-w-5xl`，改为 `w-full`

```tsx
<div className="relative z-10 shrink-0 w-full">
  <ParameterFormDock layout="page" />
</div>
```

- [ ] **Step 3:** `ChatInput.tsx` page 分支 — 去掉重复 `stoChatShellPageClass`，保留 `w-full pt-2`

```tsx
isEmbedded
  ? cn('px-0 pb-0 pt-0', stoChatShellHomeClass)
  : cn('w-full pb-0 pt-2', className),
```

- [ ] **Step 4:** 消息区如需与输入对齐，确认 toolbar 也在同一 px-6 列内（不应再单独加 px）

- [ ] **Step 5:** 手动验证：不开预览 / 开预览 / 拖拽后，消息与输入左右边缘对齐

- [ ] **Step 6:** Commit

```bash
git add src/pages/Chat/index.tsx src/pages/Chat/ChatInput.tsx
git commit -m "fix(chat): unify chat column width for messages, dock, and input"
```

---

### Task 4: 三栏比例 + 记忆 + 卡片布局（Bug 4.2 + §5 面板）

**Files:**
- Modify: `src/pages/Chat/index.tsx`

- [ ] **Step 1:** 替换 `useState(70)` 为 settings store

```tsx
const previewSplitPercent = useSettingsStore((s) => s.previewSplitPercent);
const setPreviewSplitPercent = useSettingsStore((s) => s.setPreviewSplitPercent);
```

- [ ] **Step 2:** 拖拽 handler L373 改为 `Math.max(w * 0.5, Math.min(w * 0.7, …))`

- [ ] **Step 3:** cleanup 时 `setPreviewSplitPercent(clampPreviewPanelPercent(...))`

- [ ] **Step 4:** 外层三栏容器加 `gap-2 p-2`（或按设计 8px），对话区包 `stoSplitChatCardClass`

- [ ] **Step 5:** 预览 pane 用 `stoSplitPreviewCardClass`，去掉 `ChatPreviewPanel` 上 `border-l`

- [ ] **Step 6:** 拖拽条改样式（宽度 4–6px，默认透明/hover primary/40，中间手柄 h-8 w-0.5）

- [ ] **Step 7:** `style={{ width: \`${previewSplitPercent}%\` }}` 保留（inline 例外）

- [ ] **Step 8:** Commit

```bash
git add src/pages/Chat/index.tsx
git commit -m "fix(chat): default 50-50 split, persist ratio, card layout for panes"
```

---

### Task 5: 预览区遮挡修复（Bug 4.3）

**Files:**
- Modify: `src/pages/Chat/ChatPreviewPanel.tsx`

- [ ] **Step 1:** 预览面板根元素加 chrome 安全区

```tsx
className={cn(
  'flex min-h-0 min-w-0 flex-col bg-[var(--sto-main-card-bg)]',
  className,
)}
```

- [ ] **Step 2:** Tab 行容器

```tsx
<div className={cn(
  'shrink-0 pt-[var(--sto-chrome-h)]',
  window.electron?.platform === 'win32' && 'pr-[120px]',
)}>
```

- [ ] **Step 3:** macOS 侧栏折叠展开钮场景：若仍重叠，加 `pl-20` 或 `pt` 已够则跳过

- [ ] **Step 4:** 实测 Windows + macOS：头部按钮可点、不被 traffic light / 窗口控件盖住

- [ ] **Step 5:** Commit

```bash
git add src/pages/Chat/ChatPreviewPanel.tsx
git commit -m "fix(chat): reserve chrome space in preview panel header"
```

---

### Task 6: 预览头部双行 + tab 关闭（§4.4）

**Files:**
- Modify: `src/pages/Chat/ChatPreviewPanel.tsx`
- Modify: `src/hooks/use-chat-preview-panel.ts`
- Modify: `src/pages/Chat/index.tsx`（传新 props）

- [ ] **Step 1:** hook 增加 dismissed 集合 + `dismissPreviewFile(path)` + `visibleFiles`

```ts
const [dismissedFilePaths, setDismissedFilePaths] = useState<Set<string>>(() => new Set());

const dismissPreviewFile = useCallback((filePath: string) => {
  setDismissedFilePaths((prev) => new Set(prev).add(filePath));
  // 若关闭的是当前 active → 切到下一个 visible
  // 若 visible 为空 → closePreviewPanel()
}, [/* ... */]);
```

- [ ] **Step 2:** 导出 `dismissPreviewFile`，`previewableFiles` 改为 visible 列表

- [ ] **Step 3:** `ChatPreviewPanel` 拆头部为两行组件（可同文件内 `PreviewTabRow` / `PreviewActionRow`）

**Tab 行要点（MCP 组 7047）：**
- 高 30px tab pill，`rounded-[10px]`
- 选中：`bg-border`（#E5E6EB）
- 未选：`bg-[#F5F6F7]`
- 文案：`text-sm leading-[18px]`
- × 按钮：`h-3 w-3 text-muted-foreground`

**操作行要点（MCP Header）：**
- 高 52px，`border-b border-border`，`px-4 py-3`（≈ 11px 18px 9px 16px）
- 标题 `text-sm font-medium`
- 元信息 `text-xs text-[#A4AAB3]`（有数据才渲染）
- 图标按钮 30×30 `rounded-[7px]`

- [ ] **Step 4:** 条件隐藏原 file switcher（L213–270）+ 注释 `{/* legacy file switcher — replaced by tab row, task-4 */}`

- [ ] **Step 5:** 右端收起钮替代原全局 Close `×`（Close 从操作行移除）

- [ ] **Step 6:** i18n — 新文案走 `chat` namespace（「编辑工作流」等若已有 key 则复用）

- [ ] **Step 7:** Commit

```bash
git add src/hooks/use-chat-preview-panel.ts src/pages/Chat/ChatPreviewPanel.tsx src/pages/Chat/index.tsx
git commit -m "feat(chat): two-row preview header with artifact tabs"
```

---

### Task 7: 自检验收

**Files:** none（验证为主）

- [ ] **Step 1:** 样式自检（02-styles.mdc）

```bash
grep -n "style={{" src/pages/Chat/index.tsx src/pages/Chat/ChatPreviewPanel.tsx
# 仅允许 preview width inline
```

- [ ] **Step 2:** diff 范围自检 — 仅 §2 文件 (+ plan doc)

```bash
git diff main --name-only
```

- [ ] **Step 3:** 类型检查

```bash
pnpm run typecheck
```

- [ ] **Step 4:** Lint

```bash
pnpm run lint
```

- [ ] **Step 5:** 手动四状态截图对比设计稿

| 状态 | 验证点 |
|---|---|
| 1 双栏对话 | 输入/消息对齐；卡片 18px 圆角 |
| 2 侧栏折叠 | 对话区居中，max-w-862 内 |
| 3 开预览 | **50:50** 默认 |
| 4 拖到极限 | 预览 **70%**，对话 **30%** |
| 重开预览 | 比例与上次一致 |
| Windows | 预览头部按钮不被窗口控件遮挡 |

- [ ] **Step 6:** 回归 `HomeMainConversation`、`TaskSubitemChatSurface` 输入区无错位

- [ ] **Step 7:** Final commit if fixups needed

---

## Spec Coverage Self-Review

| 文档要求 | 对应 Task |
|---|---|
| §4.1 输入/浮层/消息同宽 | Task 3 |
| §4.2 50 默认 + 50–70 拖拽 + 记忆 | Task 1, 2, 4 |
| §4.3 预览遮挡 | Task 5 |
| §4.4 双行头部 + tab 关闭 | Task 6 |
| §5 卡片化 + 拖拽条样式 | Task 2, 4 |
| §6 两阶段 | 本文档 |
| §7 自检 + 回归 | Task 7 |
| 不改预览内容渲染 | ✅ 不动 FilePreviewViewer / WorkflowPreviewPanel 内部 |
| 不改收发逻辑 | ✅ 仅 hook 增 dismissed 本地态 |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-23-chat-flow-three-column.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 按 Task 0–7 逐 task 派 subagent，task 间 review
2. **Inline Execution** — 本会话用 executing-plans 批量执行，checkpoint 暂停确认

**请先确认阶段一 🟥#1–#9，再进入阶段二写码。**
