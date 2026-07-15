## Context

对话输入框已有 **WorkflowPicker** 模式可复用：

| 能力 | 工作流（现状） | 技能（本 change） |
|------|----------------|-------------------|
| 触发符 | `/` | `*` |
| 工具栏按钮 | Workflow icon → toggle picker | Wrench icon → toggle picker |
| 数据源 | `useMyPublishedWorkflows` | `useSkillPlazaStore.mySkills`（已安装） |
| 选中后 | `insertWorkflowSpan` | `insertSkillSpan`（已有） |
| 浮层搜索 | 有（icon 模式） | 有（icon 模式）；`*` 模式用 editor inline query |

`skill-plaza-use-composer-tag` 已实现 skill token DOM、`skillMeta` 发送链路与气泡 Tag。本 change **仅补 Picker UI 与触发逻辑**，不重复发送/持久化设计。

产品稿要点（见 change 附件图）：

1. 浮层标题区「技能」
2. 每行：wrench 图标 + **title**（13px medium）+ **description**（11px muted，单行 truncate）
3. 列表区域 **最多展示 5 行**，超出 **内部滚动**（非整页滚动）
4. 工具 icon 入口：浮层顶部 **搜索框**（Search icon +「搜索技能」）
5. 筛选时 title / description 内匹配片段 **橙色高亮**（Brand-6）

## Goals / Non-Goals

**Goals:**

- `*` 与 wrench icon 双入口打开同一 `SkillPicker` 组件（props 区分是否显示内置搜索框、是否使用 inline query）
- 列表仅已安装技能；打开时 lazy-load `fetchMySkills`（若 cache 空）
- 可见行数 cap 5 + `overflow-y: auto`
- inline / 搜索框双通道 filter：匹配 `title` + `description`（case-insensitive，substring）
- 匹配高亮使用 Brand-6，背景/容器遵循 Grey 阶梯与 glass 浮层（参照 WorkflowPicker）
- 选中 → `insertSkillSpan` → 关闭 picker → 不 auto-send

**Non-Goals:**

- 替换技能广场「使用」按钮（仍保留 `?skill=` 深链）
- Picker 内展示 defaultPrompt
- 多 skill token 并存

## Decisions

### 1. 触发符：`*`（工作流继续占用 `/`）

**Rationale**: 产品明确要求；与 WorkflowPicker `e.key === '/'` 并行，冲突面最小。

**Alternative considered**: `#` 作为触发符 → 与钉钉 @、markdown 语义易混淆；用户描述中「#异常」指搜索词「异常」，非第二触发符。Rejected。

**Implementation sketch**:

```typescript
// ChatInput onKeyDown — mirror workflow branch
if (e.key === '*' && !skillPickerOpen && !hasSkillInEditor) {
  setSkillPickerOpen(true);
  setSkillPickerMode('inline'); // query from editor after *
}
```

### 2. 单一 `SkillPicker` 组件，双模式 props

**Rationale**: icon 点击与 `*` 触发共享列表 UI，避免 duplicate；差异仅在 query 来源与是否渲染搜索 input。

```typescript
interface SkillPickerProps {
  open: boolean;
  mode: 'inline' | 'toolbar';
  /** inline: text after leading * in editor; toolbar: controlled search input */
  query: string;
  onQueryChange?: (q: string) => void;
  onSelect: (skill: { slug: string; title: string }) => void;
  onClose: () => void;
}
```

**Alternative considered**: 两个组件 `SkillInlinePicker` / `SkillToolbarPicker` → 列表/高亮/滚动重复。Rejected。

### 3. 列表高度：5 行固定可见 + 内部滚动

**Rationale**: 产品稿标注「最多展示 5 行，超出在内部支持滚动」。

**Implementation**: 单行高度约 `py-2.5` + 双行文本 ≈ 52–56px；`max-h` ≈ `5 * 52px = 260px`（或 token `--skill-picker-row-h * 5`）。使用 `overflow-y-auto`。

**Alternative considered**: 虚拟列表 → 已安装技能量级通常 <50，无需虚拟化。Rejected。

### 4. 筛选与高亮

**Rationale**: 匹配范围 = `title` + `description`（与技能广场搜索一致）。高亮 MUST 使用 **Brand-6**（`docs/sto-design.md`），不用 ad-hoc 色值。

**Helper**: `highlightMatch(text, query) → ReactNode[]` — 对 case-insensitive 命中区间包 `<span className="text-[#FF6F00]">` 或 semantic token `text-brand-6`。

**Inline 模式 query 提取**:

- 用户输入 `*` 后打开 picker
- 从 editor `plainText` 或 caret 前文本解析：最近一次 `*` 之后至 caret 的字符串为 filter query（例：`*异常` → query=`异常`）
- 选中技能后 MUST 删除 trigger 段（`*` + query），再 `insertSkillSpan`（避免 plainText 残留 `*异常`）

**Alternative considered**: 保留 `*query` 在 plainText 中 → 会进入用户消息正文。Rejected。

### 5. 选中后插入：复用 `insertSkillSpan`

**Rationale**: 与技能广场 seed、发送、气泡、transcript marker 全链路一致。

**Rules**:

1. `insertSkillSpan` 前清除 workflow token（互斥）
2. 替换已有 skill token（唯一性）
3. 不调用 `sendMessage`

### 6. 浮层位置与层级

**Rationale**: 与 WorkflowPicker 一致——`absolute left-0 bottom-full mb-2 z-50`，宽度约 `w-80` ~ `w-[360px]`（贴近设计稿）。

**Toolbar 模式**: 搜索框在列表上方；**Inline 模式**: 可不显示搜索框（query 来自 editor），或显示只读/filter 同步区——**Decision**: inline 模式 **不渲染搜索 input**，仅上方列表 + 标题「技能」，filter 完全由 editor 驱动（符合图五：输入框上方列表随「异常」过滤）。

### 7. 数据与空态

**Source**: `useSkillPlazaStore(s => s.mySkills)`；`open` 时若 empty 且未 loading 则 `fetchMySkills()`。

**Empty states**:

- 无已安装技能 →「暂无已安装技能」+ 可选引导文案（去技能广场）
- 有技能但 filter 无结果 →「无匹配技能」

## Risks / Trade-offs

- **[Risk]** `*` 与 Shift+8、IME 组合键冲突  
  **→ Mitigation**: 仅在 `key === '*'` 且非 composition 中触发；与 `/` 相同 guard

- **[Risk]** inline 模式删除 `*query` 时破坏 mention / workflow 光标  
  **→ Mitigation**: 在 composer 层提供 `consumeSkillTriggerQuery(root): string` 单测覆盖

- **[Risk]** `mySkills` 与 plaza 列表不同步  
  **→ Mitigation**: picker open 时 refetch；选中 slug 找不到 title 时 fallback slug

- **[Risk]** 与 `skill-plaza-use-composer-tag` 浮层样式 drift  
  **→ Mitigation**: 复用 `skillComposerTagClass` / wrench 图标；Picker 行 icon 与 token 一致

## Open Questions

1. **键盘导航**：本期是否必须支持 ↑↓ + Enter？（建议 follow WorkflowPicker；若无则 tasks 标 optional）
2. **Home 与 Chat 双入口**：`HomeComposer` / `ChatInput` 是否共用同一 `SkillPicker` 挂载点？（建议共用 `ChatInput` 内实现，Home 仅透传）

## Resolved Questions

- **触发符用 `/` 还是 `*`？** ✅ `*`。`/` 留给工作流。
- **用户示例「#异常」是否表示 `#` 触发？** ✅ 否。`#` 为示例中的强调写法；实际 filter 关键词为「异常」，在 `*` 触发后继续输入（即 editor 内 `*异常` 或 picker 搜索框输入「异常」）。
- **列表展示未安装技能？** ✅ 否。仅已安装（mySkills）。

## Implementation Phases (for tasks.md)

| Phase | 范围 | 估时 |
|-------|------|------|
| 1 | SkillPicker 组件 + 样式 token + i18n | 0.5d |
| 2 | ChatInput `*` 触发 + inline query + 插入 | 0.5d |
| 3 | 工具 icon + toolbar 搜索模式 | 0.25d |
| 4 | Home 复用 + 单测 + 手工回归 | 0.25d |
