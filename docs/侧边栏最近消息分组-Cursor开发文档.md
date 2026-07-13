# 侧边栏改造 · 最近消息分组 · Cursor 开发文档

> 适用项目：`/Users/zzj/Desktop/workspace/sto/backend-project/sto-claw/`
>
> 当前对话工作区：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 重要：构建、打包一律从源项目 `/Users/zzj/Desktop/workspace/sto/backend-project/sto-claw/` 执行，不要从 Kilo worktree 或临时快照执行。

## 1. 目标

在侧边栏「最近」消息区域增加用户自定义分组能力。

目标交互：

```text
任务
...

我的分组1  v
  会话 A
  会话 B

我的分组2  >
我的分组3  >

最近  v
  未分组会话 C
  未分组会话 D
```

核心规则：

- 分组标题显示在「最近」标题上方。
- 分组按创建时间正序排列，早创建的在上面。
- 「最近」本身保留展开/收起能力。
- 「最近」只展示未分组会话。
- 空分组保留；展开后按设计稿展示「暂无会话」。
- 「最近」展开但无未分组会话时展示「暂无未分组会话」。
- 会话移动到目标分组后，自动展开目标分组。
- 当前会话位于某个收起分组内时，进入/切换到该会话后自动展开所在分组。
- 分组名称允许重名。

## 2. 必须遵守的工程边界

- 这是新功能，必须先补 OpenSpec artifact：proposal -> design -> specs -> tasks。
- UI 变更必须对齐设计稿 MCP；本次样式事实来源优先级为：设计稿 MCP > `.cursor/rules/02-styles.mdc` > `docs/sto-design.md` > 现有代码近似值。
- Cursor 会拿设计稿 MCP；样式实现时必须以 MCP 精确值为主。
- 如果设计稿 MCP 与 `.cursor/rules/02-styles.mdc` 不一致，先按 MCP 实现，并把差异同步沉淀到 `02-styles.mdc`；不要为了迁就旧 rules 而偏离设计稿。
- Cursor 必须同时遵守 `.cursor/rules/01-code-rules.mdc` 与 `.cursor/rules/02-styles.mdc`。
- Renderer 不能直接调用 Gateway HTTP，也不要新增 `window.electron.ipcRenderer.invoke(...)`。本功能推荐仅使用本地 Zustand persist，不需要新增 Gateway 调用。
- 不修改 `package.json`、lockfile、构建配置、构建脚本、CI/CD。
- 不执行安装、升级、移除依赖命令。
- 不引入新依赖。图标优先用现有 `lucide-react`。
- 不新增 `dark:` class。现有代码里的 `dark:` 不作为本次清理目标，但本功能新增样式不要继续写 `dark:`。
- React 19 + React Compiler：新增代码不要默认用 `useMemo` / `useCallback` / `React.memo` 包所有函数和值。只有 `.cursor/rules/01-code-rules.mdc` 允许的例外场景才使用，并写注释说明原因。
- Zustand 使用单字段 selector；回调内读取当前 store 值时用 `useXxxStore.getState()`。
- 所有用户可见文案必须走 i18n。

## 3. 当前代码现状

### 3.1 侧边栏主体

文件：`src/components/layout/Sidebar.tsx`

关键位置：

- `Sidebar` 组件入口：约 `L701`。
- 现有 `recentOpen` 状态：约 `L743`。
- 任务区渲染：约 `L1659-L1705`。
- 「最近」标题渲染：约 `L1715-L1723`。
- 最近会话列表渲染：约 `L1777-L1940`。
- 折叠态最近会话渲染：约 `L1733-L1776`。

当前普通最近会话来源：

```ts
const normalSessions = useMemo(
  () => visibleSessions.filter((s) => (
    !isAnyCronSessionKey(s.key)
    && !parseScheduledTaskAgentSessionKey(s.key)
    && !parseClaudeScheduledTaskRunSessionKey(s.key)
    && !parseClaudeScheduledTaskSessionKey(s.key)
  )),
  [visibleSessions],
);

const recentSessionsSorted = useMemo(
  () => sortSessionsByRecentActivity(normalSessions, sessionLastActivity),
  [normalSessions, sessionLastActivity],
);
```

### 3.2 最近会话行尾操作

文件：`src/components/layout/sidebar-recent-session-row-trailing.tsx`

现状：

- 默认显示 `SidebarRecentSessionStatus`。
- hover 时显示 `Pencil` 和 `Trash2` 两个 icon button。
- 本次需要改为 hover/常规操作槽显示 `MoreHorizontal`，点开后展示菜单：
  - 重命名
  - 分组 >
  - 删除

### 3.3 删除确认

文件：

- `src/stores/sidebar-delete-confirm.ts`
- `src/components/layout/sidebar-delete-confirm-portal.tsx`

现状：

- 已有会话删除确认 store。
- 已有任务子项删除确认 store。
- 本次会话删除文案需要改为设计稿文案：

```text
确定删除吗？
删除后会话将无法恢复，请谨慎处理。
```

删除成功后需要 toast：`删除成功`。

### 3.4 最近排序工具

文件：`src/lib/sidebar-recent-order.ts`

现状：

- `sortSessionsByRecentActivity` 按活跃时间排序。
- 本次分组内会话、未分组会话继续复用该排序结果，不改变原有最近排序语义。

## 4. OpenSpec 建议

建议 change id：

```text
sidebar-recent-message-groups
```

建议新增：

```text
openspec/changes/sidebar-recent-message-groups/proposal.md
openspec/changes/sidebar-recent-message-groups/design.md
openspec/changes/sidebar-recent-message-groups/tasks.md
openspec/changes/sidebar-recent-message-groups/specs/sidebar-recent-message-groups/spec.md
```

spec 能力名建议：`sidebar-recent-message-groups`。

spec 需要覆盖：

- 最近会话分组的创建、重命名、解散。
- 会话加入分组、换组、取消分组。
- 空分组保留和空态展示。
- 分组排序为创建时间正序。
- 目标分组和当前会话所在分组的自动展开。
- 「最近」展示未分组会话，并保留折叠能力。
- i18n 三语文案。
- 视觉对齐设计稿 MCP；如 MCP 引入新的稳定 token/组件规则，同步更新 `.cursor/rules/02-styles.mdc`，并确保不违背 `docs/sto-design.md` 的主题语义。

## 5. 数据模型方案

建议新增文件：

```text
src/stores/sidebar-recent-groups.ts
```

使用 Zustand `persist`。不要塞进 `useChatStore`，因为这是侧边栏 UI 辅助状态，和 OpenClaw 会话列表生命周期不同。

说明：

- 这是 UI 辅助状态，允许使用 Zustand persist。
- 不要直接手写裸 `localStorage.setItem/getItem` 存业务数据。
- 不存敏感信息。

建议类型：

```ts
export interface SidebarRecentGroup {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface SidebarRecentGroupsState {
  groups: SidebarRecentGroup[];
  sessionGroupByKey: Record<string, string>;
  expandedGroupIds: Record<string, boolean>;

  createGroupAndAssignSession: (name: string, sessionKey: string) => string | null;
  assignSessionToGroup: (sessionKey: string, groupId: string) => void;
  ungroupSession: (sessionKey: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  dissolveGroup: (groupId: string) => void;
  toggleGroup: (groupId: string) => void;
  expandGroup: (groupId: string) => void;
  pruneMissingSessions: (sessionKeys: string[]) => void;
}
```

行为规则：

- `groups` 按 `createdAt` 正序渲染；store 内也可以始终保持正序。
- `createGroupAndAssignSession` 创建新分组并把当前会话加入该分组；新分组默认展开。
- `assignSessionToGroup` 把会话移动到目标分组；目标分组自动展开。
- `ungroupSession` 删除 `sessionGroupByKey[sessionKey]`，会话回到「最近」。
- `renameGroup` 允许重名，只 trim 空白；空名称不提交。
- `dissolveGroup` 删除分组，并清除所有指向该分组的 `sessionGroupByKey`；这些会话回到「最近」。
- 删除会话成功后调用 `pruneMissingSessions` 或专门的 `removeSessionAssignment`，清理已删除会话的分组映射。
- 空分组必须保留，不因最后一个会话移走或删除而自动删除。

存储名建议：

```ts
name: 'stoclaw:sidebar-recent-groups'
```

## 6. 分组整理 helper

建议新增文件：

```text
src/lib/sidebar-recent-groups.ts
```

职责：纯函数，方便测试。

建议 API：

```ts
export interface SidebarRecentGroupSection<TSession> {
  group: SidebarRecentGroup;
  sessions: TSession[];
}

export function buildSidebarRecentGroupSections<TSession extends { key: string }>(input: {
  groups: SidebarRecentGroup[];
  sessionsSortedByRecent: TSession[];
  sessionGroupByKey: Record<string, string>;
}): {
  groupedSections: SidebarRecentGroupSection<TSession>[];
  ungroupedSessions: TSession[];
}
```

规则：

- `groups` 按 `createdAt` 升序。
- 会话属于不存在的 groupId 时，当作未分组展示；可由 `pruneMissingSessions` 在 effect 中清理。
- 每个分组内的会话顺序保持 `sessionsSortedByRecent` 的相对顺序。
- `ungroupedSessions` 也保持 `sessionsSortedByRecent` 的相对顺序。

## 7. UI 组件方案

### 7.1 最近会话行组件

建议从 `Sidebar.tsx` 内抽出或新增：

```text
src/components/layout/sidebar-recent-session-row.tsx
```

职责：

- 渲染会话标题、选中态、状态位。
- 支持 inline rename 或使用弹窗 rename；为了减少改动，可沿用当前 inline input。
- 使用新的 `SidebarRecentSessionRowTrailing` 菜单。

必要 props：

```ts
session
label
active
isEditing
editingValue
groups
currentGroupId
onOpen
onStartRename
onCommitRename
onCancelRename
onDelete
onCreateGroup
onAssignGroup
onUngroup
```

Cursor 实现要求：

- Props 必须用 `interface` 显式声明，不能 inline `{ ... }`。
- 组件顶部写 TSDoc：说明用途、使用位置、特殊约束。
- 每个 prop 写 TSDoc，说明业务含义。
- 回调 prop 用 `on*` 命名，内部函数用 `handle*` 命名。
- 不使用 `defaultProps`，可选 prop 默认值用函数参数解构默认值。

### 7.2 行尾菜单

修改 `src/components/layout/sidebar-recent-session-row-trailing.tsx`。

菜单结构：

未分组会话：

```text
重命名
分组 >
  新建分组
  我的分组1
  我的分组2
删除
```

已分组会话：

```text
重命名
分组 >
  不分组
  新建分组
  我的分组1
  我的分组2
删除
```

细节：

- 当前所在分组仍显示，建议用 `Check` 标记选中，点击 no-op。
- `删除` 使用 danger 文本语义。
- 子菜单使用现有 `DropdownMenuSub` / `DropdownMenuSubTrigger` / `DropdownMenuSubContent`。
- 右侧操作入口图标用 `MoreHorizontal`。

### 7.3 分组标题行组件

建议新增：

```text
src/components/layout/sidebar-recent-group-row.tsx
```

结构：

```text
我的分组1  v      ...
```

行为：

- 点击标题/箭头展开或收起。
- hover 显示 `...` 菜单。
- 菜单：
  - 重命名
  - 解散分组
- 收起时如果组内有未读会话，可显示既有 `sidebarUnreadDotClass` 红点；这点建议实现，和任务分组体验一致。
- 标题行高度、padding、圆角、hover、文本色优先复用 `SIDEBAR_TASK_GROUP_ROW_CLASS`、`sidebarListItemTextClass`、`sidebarTextIconClass`，最终以设计稿 MCP 校准。

### 7.4 分组弹窗

建议新增：

```text
src/components/layout/sidebar-recent-group-dialogs.tsx
```

包含两个输入弹窗和一个确认弹窗：

1. 添加到新分组

```text
添加到新分组

分组名称
[ 我的分组 ]

取消   确认
```

确认后：

- 创建分组。
- 当前会话加入新分组。
- 新分组自动展开。
- toast：`已添加到分组`。

2. 重命名

```text
重命名

分组名称
[ 我的分组1 ]

取消   确认
```

确认后：

- 更新分组名。
- toast：`重命名成功`。

3. 解散分组确认

```text
确定解散这个分组吗？
解散后，此分组下的会话将移到“最近”下。

取消   解散分组
```

确认后：

- 删除分组。
- 组内会话回到「最近」。
- toast：`分组已解散`。

实现方式：

- 可参考 `src/components/ui/confirm-dialog.tsx`。
- 输入弹窗可用 Radix Dialog，如果项目已有对应 UI primitives 则复用；不要引入新依赖。
- 浮层组件必须使用 Radix Portal。若项目已有 shadcn Dialog/Input/Button 原件则复用；不要通过包管理器新增组件或依赖。

## 8. Sidebar 渲染改造方案

在 `Sidebar.tsx` 中引入：

- `useSidebarRecentGroupsStore`
- `buildSidebarRecentGroupSections`
- 新增 group row / session row / dialogs
- `toast` from `sonner`

新增派生数据。按 React 19 规则，新增代码优先写朴素计算；不要默认包 `useMemo`：

```ts
const recentGroups = useSidebarRecentGroupsStore((s) => s.groups);
const sessionGroupByKey = useSidebarRecentGroupsStore((s) => s.sessionGroupByKey);
const expandedGroupIds = useSidebarRecentGroupsStore((s) => s.expandedGroupIds);

const {
  groupedSections,
  ungroupedSessions,
} = buildSidebarRecentGroupSections({
  groups: recentGroups,
  sessionsSortedByRecent: recentSessionsSorted,
  sessionGroupByKey,
});
```

渲染顺序：

```tsx
{!sidebarCollapsed && groupedSections.map((section) => (
  <SidebarRecentGroupRow ... />
  {isOpen ? (
    section.sessions.length > 0
      ? section.sessions.map(...)
      : <EmptyText>暂无会话</EmptyText>
  ) : null}
))}

<SidebarCollapsibleSectionLabel label={t('common:sidebar.recent')} ... />

{!sidebarCollapsed && recentOpen ? (
  ungroupedSessions.length > 0
    ? ungroupedSessions.map(...)
    : <EmptyText>暂无未分组会话</EmptyText>
) : null}
```

注意：

- 分组标题必须在「最近」标题上方。
- 「最近」标题 sticky 仍保留。
- 分组标题是否 sticky：不建议 sticky，按设计稿若有要求再实现。默认只有「任务」「最近」沿用现有 sticky。
- 折叠态 sidebar 先保持现状：仍显示所有普通最近会话的缩略入口，不展示分组层级，避免折叠态空间不够。若设计稿 MCP 明确要求折叠态分组，再单独处理。
- `recentVisibleCount` 的「显示更多」只作用于「最近」未分组列表；分组内暂不做分页，除非产品另行确认。

## 9. 自动展开逻辑

### 9.1 移动会话到分组

`assignSessionToGroup(sessionKey, groupId)` 内部调用 `expandGroup(groupId)`。

### 9.2 新建分组并加入会话

`createGroupAndAssignSession(name, sessionKey)` 内部将新 groupId 设置为展开。

### 9.3 当前会话在收起分组内

在 `Sidebar.tsx` 加 effect：

```ts
useEffect(() => {
  if (sidebarCollapsed) return;
  if (!currentSessionKey || currentSessionKey === DEFAULT_SESSION_KEY) return;
  const groupId = sessionGroupByKey[currentSessionKey];
  if (!groupId) return;
  expandRecentGroup(groupId);
}, [sidebarCollapsed, currentSessionKey, sessionGroupByKey, expandRecentGroup]);
```

说明：这是 `useEffect` 依赖语义场景，若 `expandRecentGroup` 来自 Zustand selector 并需要稳定引用，可按 rules 判断是否使用 `useCallback`；不要为了性能无脑包装。

## 10. 删除和清理逻辑

当前普通会话删除入口最终走 `requestSessionDelete` -> `confirmSidebarSessionDelete` -> `deleteSession`。

需要确保删除成功后：

- 清理该会话的 `sessionGroupByKey`。
- 空分组保留。
- toast `删除成功`。

实现建议：

- 扩展 `Sidebar` 中传入删除 executor 的逻辑，普通最近会话删除成功后调用 recent groups store 的清理 action。
- 当前 `executeScheduledSessionDelete` 主要服务任务/定时任务会话，注意不要破坏其特殊逻辑。
- 如果复用同一个 delete executor，需要确认普通会话和任务会话的分支不会互相影响。

## 11. i18n 文案

至少更新：

```text
src/i18n/locales/zh/common.json
src/i18n/locales/en/common.json
src/i18n/locales/ja/common.json
```

建议 key：

```json
{
  "sidebar": {
    "group": "分组",
    "newGroup": "新建分组",
    "addToNewGroup": "添加到新分组",
    "groupName": "分组名称",
    "ungroup": "不分组",
    "dissolveGroup": "解散分组",
    "dissolveGroupTitle": "确定解散这个分组吗？",
    "dissolveGroupMessage": "解散后，此分组下的会话将移到“最近”下。",
    "emptyGroupSessions": "暂无会话",
    "emptyUngroupedSessions": "暂无未分组会话",
    "deleteSessionTitle": "确定删除吗？",
    "deleteSessionMessage": "删除后会话将无法恢复，请谨慎处理。",
    "groupAdded": "已添加到分组",
    "groupMoved": "已移动到分组",
    "groupUngrouped": "已恢复到最近",
    "groupDissolved": "分组已解散",
    "deleteSessionSucceeded": "删除成功",
    "renameGroupSucceeded": "重命名成功"
  },
  "actions": {
    "rename": "重命名"
  }
}
```

如果已有 `actions.edit`，菜单里建议显示「重命名」而不是「编辑」，因此新增 `actions.rename` 更清晰。

## 12. 样式对齐要求

Cursor 必须通过设计稿 MCP 读取，并映射到 `.cursor/rules/02-styles.mdc`。本次样式以 MCP 为主；`02-styles.mdc` 是承接和沉淀规则，不是覆盖 MCP 的上位来源。

- 分组标题行高度、padding、gap、圆角、hover 背景、选中/普通文本色。
- 会话项菜单 `...` 的尺寸、位置、hover 态。
- 下拉菜单宽度、圆角、阴影、分隔线、danger 项颜色。
- 弹窗宽度、圆角、padding、标题字号、输入框高度、按钮样式。
- 空态「暂无会话」「暂无未分组会话」字号、颜色、上下间距。

实现原则：

- 优先复用 `src/lib/surfaces.ts` 里的侧边栏 token/class。
- 不造新的主色；品牌强调、危险、成功、文字层级优先取设计稿 MCP，并同步沉淀到 `.cursor/rules/02-styles.mdc`。
- 当前 `02-styles.mdc` 中品牌色为 `#FF6700` / `--sto-brand-6` / `bg-primary`；如果设计稿 MCP 给出不同值，以 MCP 为准，并同步更新 `02-styles.mdc` 的相关 token 说明。
- 侧栏正文/图标/分区标题必须使用 `src/lib/surfaces.ts` 已有 surface class：`sidebarListItemTextClass`、`sidebarTextIconClass`、`sidebarSectionLabelClass`、`sidebarSubitemTextIdleClass`、`sidebarSubitemTextActiveClass`、`sidebarUnreadDotClass` 等。
- 侧栏业务代码禁止裸写 `#86909C` / `#4E5969` / `#1D2129` 等 hex。
- 卡片圆角不要超过设计稿；侧边栏行项优先沿用现有 8px 体系。
- 文本必须 truncate，不能撑宽侧边栏。
- className 拼接必须用 `cn()`；不要模板字符串拼 className。
- 所有装饰图标加 `aria-hidden`；可点击图标按钮要有 `aria-label`。

## 13. 测试建议

### 13.1 单元测试

新增：

```text
tests/unit/sidebar-recent-groups.test.ts
```

覆盖：

- 分组按 `createdAt` 正序。
- 分组内会话保持最近排序相对顺序。
- 未分组会话只出现在「最近」。
- 指向不存在 groupId 的会话回退到未分组。
- 空分组保留并出现在 groupedSections 中。
- 解散分组后会话回到未分组，分组消失。
- 删除会话映射清理后空分组仍保留。

### 13.2 组件/交互测试

视项目现有测试能力补充：

- 打开会话 `...` 菜单，存在 `重命名 / 分组 / 删除`。
- 未分组会话子菜单不显示 `不分组`。
- 已分组会话子菜单显示 `不分组`。
- 新建分组后分组出现在「最近」上方，且目标分组展开。
- 「最近」无未分组会话时显示「暂无未分组会话」。
- 空分组展开显示「暂无会话」。
- 当前会话在收起分组内时自动展开。

### 13.3 手动验证

- 设计稿 MCP 对齐后，用浏览器/应用截图检查侧边栏普通态。
- 验证窄侧边栏文本不会溢出。
- 不新增 `dark:` class；现有深色相关 class 不在本任务清理范围内。
- 验证侧边栏 collapsed 态保持现状不破。
- 验证任务列表、定时任务分组、STO 任务子项不受影响。

推荐命令：

```bash
pnpm run typecheck
pnpm test -- sidebar-recent-groups
pnpm test -- sidebar-recent-order
```

如本次触碰通信路径则还需：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

本功能按推荐方案不触碰通信路径，通常不需要 comms replay。

## 14. 开发顺序建议

按 Cursor rules，不要让 Cursor 一次到底。必须分两阶段：

### Phase 1：只输出设计层，不写代码

让 Cursor 先输出：

- OpenSpec artifact 文件清单与每个文件要写的需求点。
- 代码文件清单：路径、一句话职责、新建/修改、是否需要从 `Sidebar.tsx` 抽组件。
- 组件 Props interface 草案，含 TSDoc。
- Zustand store state/actions 草案。
- 视觉 token 对照表：设计稿 MCP 值 -> `02-styles.mdc` token/surface class；如不一致，列出需要同步更新 `02-styles.mdc` 的条目。
- 与现有代码冲突或不确定点。
- 需要用户确认的产品细节。

你确认 Phase 1 后，再让 Cursor 写代码。

### Phase 2：按确认后的方案实现

1. 补 OpenSpec artifacts，并在 design 中引用 `docs/sto-design.md` 和 `.cursor/rules/02-styles.mdc`。
2. 实现 `src/stores/sidebar-recent-groups.ts`。
3. 实现 `src/lib/sidebar-recent-groups.ts` 和单元测试。
4. 改造 `sidebar-recent-session-row-trailing.tsx` 为 `...` 菜单。
5. 新增分组标题行、会话行、弹窗组件。
6. 在 `Sidebar.tsx` 接入分组派生数据和渲染顺序。
7. 接入删除后的映射清理和 toast。
8. 补 i18n 三语。
9. 跑 typecheck/test，并用设计稿 MCP + 截图核对样式。

### 可直接给 Cursor 的启动提示词

```text
请阅读并严格执行 @docs/侧边栏最近消息分组-Cursor开发文档.md。

同时遵守：
- @.cursor/rules/01-code-rules.mdc
- @.cursor/rules/02-styles.mdc
- @docs/sto-design.md

我会另给设计稿 MCP。你先不要写代码。

请先输出 Phase 1：
1. OpenSpec 文件清单与需求点
2. 代码文件清单
3. 组件 Props interface 草案（含 TSDoc）
4. Zustand store state/actions 草案
5. 视觉 token 对照表（MCP 值 -> 02-styles token/surface class）；如 MCP 与 02-styles 不一致，列出需要同步更新 02-styles.mdc 的条目
6. 与现有代码的冲突/风险
7. 需要我确认的问题

等我确认 Phase 1 后，再开始写代码。
```

## 15. 风险点

- `Sidebar.tsx` 较大，尽量抽小组件，不要继续把全部 JSX 塞回主文件。
- 普通最近会话和任务/定时任务会话删除逻辑不要混淆。
- 空分组必须保留，不能在 reducer/helper 里因为 sessions 为空而过滤掉。
- 分组名允许重名，UI 不要做重复校验。
- 现有 `recentVisibleCount` 的「显示更多」需要改为只作用于未分组「最近」；分组内是否分页暂不做，除非设计稿/产品另有要求。
- 折叠态先保持旧行为，避免新增分组层级导致空间和 tooltip 复杂化。
- 不要在本任务顺手清理旧代码里的 `dark:`、旧 `useMemo/useCallback` 或大规模 Sidebar 重构；只做与最近消息分组直接相关的改动。
- 不要新增 shadcn 组件依赖或执行 `pnpm dlx shadcn ...`；只复用项目已有组件或用现有 Radix/shadcn 原件组合。
